from django.db import models
from django.contrib.auth.models import User
import uuid

class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    url = models.URLField(null=True, blank=True)
    filename = models.CharField(max_length=255)
    placeholders = models.JSONField(default=list, help_text="List of placeholders extracted from the document")
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'documents'
        ordering = ['-created_at']

    def __str__(self):
        return f"Document {self.id}: {self.filename}"



class DocumentConversations(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE)
    conversation = models.JSONField(default=list, help_text="List of conversations")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'document_conversations'
        ordering = ['-created_at']
