from typing import OrderedDict
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .models import Document, DocumentConversations
from .agents import find_placeholder_paras, rename_placeholders, updatePlaceholders
from docx import Document as DocxDocument

import os
from dotenv import load_dotenv

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

@api_view(['POST'])
def file_upload(request):
    """
    API endpoint to upload and process a DOCX file.
    Extracts placeholders and stores them in the database.
    """
    if 'file' not in request.FILES:
        return Response(
            {'error': 'No file provided'}, 
            status=status.HTTP_400_BAD_REQUEST
        )
    
    file = request.FILES['file']
    openai_api_key = request.data.get("openai_api_key") or OPENAI_API_KEY
    if not openai_api_key:
        return Response(
            {"error": "openai_api_key is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

        
    # Validate using the metadata
    if not file.content_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return Response(
            {'error': 'Only DOCX files are supported'}, 
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        # Read the DOCX file
        file.seek(0)
        doc = DocxDocument(file)
        
        # Find paragraphs with placeholders
        placeholder_paras = find_placeholder_paras(doc)
        
        # Use AI to rename and extract placeholders
        placeholders = []
        if len(placeholder_paras) > 0:
            placeholders = rename_placeholders(placeholder_paras, openai_api_key)
        

        # Reset file pointer before saving to model
        file.seek(0)
        
        # Get user if authenticated (optional)
        user = request.user if request.user.is_authenticated else None
        
        # Create Document instance
        document = Document.objects.create(
            filename=file.name,
            placeholders=placeholders,
            user=user
        )
        
        return Response({
            'document_id': str(document.id),
            'filename': document.filename,
            'placeholders': document.placeholders,
            'message': 'File uploaded and processed successfully'
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        print(str(e))
        return Response(
            {'error': f'Error processing file: {str(e)}'}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


def update_current_placeholders(placeholders, updates):
    # Build a map of name -> list of indices for O(1) lookup (handles duplicate names)
    name_to_indices = {}
    for idx, ph in enumerate(placeholders):
        name = ph.get('name')
        if name:
            if name not in name_to_indices:
                name_to_indices[name] = []
            name_to_indices[name].append(idx)
    
    # Update placeholders using the map
    for update in updates:
        name = update['name']
        value = str(update['value'])  # Convert to string
        
        if name in name_to_indices:
            # Update all placeholders with this name (in case of duplicates)
            for idx in name_to_indices[name]:
                placeholders[idx]['value'] = value


@api_view(['POST'])
def agent_message(request):
    """
    API endpoint for users to send messages about a document.
    AI processes the message and updates placeholders or asks for clarification.
    """
    try:
        data = request.data
        document_id = data.get('id')
        message = data.get('message')
        openai_api_key = data.get('openai_api_key') or OPENAI_API_KEY

        if not openai_api_key:
            return Response(
                {"error": "openai_api_key is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        
        if not document_id:
            return Response(
                {'error': 'id is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not message:
            return Response(
                {'error': 'message is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get the document
        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response(
                {'error': 'Document not found'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get placeholders from document
        ordered_placeholders = document.placeholders.copy() if document.placeholders else []
        
        if not ordered_placeholders:
            return Response(
                {'error': 'No placeholders found for this document'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get or create DocumentConversations for this document
        doc_conversation, created = DocumentConversations.objects.get_or_create(
            document=document
        )
        
        # Get full conversation history for storage
        full_conversation_history = doc_conversation.conversation or []
        
        # Only load the last 15 conversations for AI processing (optimization)
        conversation_history_for_ai = full_conversation_history[-15:] if len(full_conversation_history) > 15 else full_conversation_history
        
        # Use AI to process the message and update placeholders with conversation history
        response_data = updatePlaceholders(message, ordered_placeholders, openai_api_key, conversation_history_for_ai)
        
        
        # Update placeholders with the AI response
        updates = response_data.get("updates", [])
        if updates:
            update_current_placeholders(ordered_placeholders, updates)
            document.placeholders = ordered_placeholders
            document.save()
        
        # Store the user message and assistant response in the conversation
        user_message = {"role": "user", "content": message}
        assistant_message = {"role": "assistant", "content": response_data.get("message", "")}
        
        # Append new messages to full conversation history
        full_conversation_history = list(full_conversation_history)  # Make a copy
        full_conversation_history.append(user_message)
        full_conversation_history.append(assistant_message)
        
        # Update and save the conversation
        doc_conversation.conversation = full_conversation_history
        doc_conversation.save()
        
        return Response(response_data, status=status.HTTP_200_OK)
        
    except Exception as e:
        if type(e) == 'dict' and e.get('message'):
            e = e['message']
        return Response(
            {'error': f'Error processing message: {str(e)}'}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
def update_placeholders(request):
    """
    API endpoint to update placeholder values.
    Accepts an array of updates with format: [{"name": "...", "value": "..."}, ...]
    Partially updates only the specified placeholders by matching name.
    """
    try:
        data = request.data
        document_id = data.get('id')
        updates = data.get('updates', [])
        
        if not document_id:
            return Response(
                {'error': 'id is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not isinstance(updates, list):
            return Response(
                {'error': 'updates must be an array'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if len(updates) == 0:
            return Response(
                {'error': 'updates array cannot be empty'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate each update item
        for update in updates:
            if not isinstance(update, dict):
                return Response(
                    {'error': 'Each update item must be an object with "name" and "value" fields'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            if 'name' not in update or 'value' not in update:
                return Response(
                    {'error': 'Each update item must have "name" and "value" fields'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Get the document
        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response(
                {'error': 'Document not found'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        placeholders = document.placeholders.copy() if document.placeholders else []
        update_current_placeholders(placeholders, updates)
        # Save updated placeholders back to document
        document.placeholders = placeholders
        document.save()
        
        # Prepare response
        response_data = {
            'document_id': str(document.id),
            'filename': document.filename,
            'placeholders': placeholders
        }
        

        return Response(response_data, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response(
            {'error': f'Error updating placeholders: {str(e)}'}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
