from docx import Document
import re
import os
import json
from typing import List, Dict
from pydantic import BaseModel, Field, ConfigDict, ValidationError, conint, constr
from openai import OpenAI
import os


# ---- Pydantic models ----
class PlaceholderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order: conint(ge=1) = Field(..., 
                            description="The 1-based index of the placeholder in the document"
                            )
    name: str = Field(..., description="The human understandable name of the placeholder in title case")
    description: constr(min_length=1) = Field(..., description="A 1-2 sentence description of the placeholder")

class RenamePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    placeholders: List[PlaceholderItem]

def rename_placeholders(paras: List[str], openai_api_key:str) -> List[PlaceholderItem]:
    client = OpenAI(api_key=openai_api_key)
    MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    prompt = """You extract bracketed placeholders from legal/financial documents and assign
        human-understandable names.

        Rules (read carefully):
        1) Output MUST be valid JSON matching the provided JSON Schema (strict).
        2) Return one PlaceholderItem PER OCCURRENCE in true document order (1-based).
        • Do NOT deduplicate. The list length MUST equal the number of bracketed matches.
        3) If two occurrences refer to the SAME underlying value (same entity/field), RE-USE the same
        `name` (exact same Title Case string) for both.
        4) If two occurrences look similar but refer to DIFFERENT meanings, use DISTINCT names and make
        the `description` clarify the difference (eg: “Company Name (Signature Block)” vs “Company Name (Header)”).
        5) `name` must be Title Case, concise (2–6 words), no brackets/underscores;
        6) `description` is 1–2 sentences that define the field in context; avoid repeating the placeholder text.
        7) Do NOT invent placeholders not present in the input. Do NOT add fields not in the schema.
        8) Use the provided `order` exactly; never skip or reorder.
        9) If uncertain whether two occurrences are the same value, prefer re-using the earlier `name`
        and note the contextual nuance in the description.
    """

    schema = RenamePayload.model_json_schema()
    user_content = "\n".join(paras)

    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user_content}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "rename_placeholders", "schema": schema, "strict": True},
        },
    )

    content = resp.choices[0].message.content or "{}"
    try:
        payload = RenamePayload.model_validate_json(content)
    except ValidationError as ve:
        raise RuntimeError(f"Pydantic validation failed:\n{ve}\nRaw: {content}")

    return [
        {"order": ph.order, "name": ph.name, "description": ph.description}
        for ph in sorted(payload.placeholders, key=lambda x: x.order)
    ]

def find_placeholder_paras(doc: Document) -> List[str]:
    # Regex to match placeholders like [Company Name]
    pattern = re.compile(r'\[([^\[\]]+)\]')
    placeholder_paras = []  
    # Scan paragraphs for placeholders
    for para in doc.paragraphs:
        matches = pattern.findall(para.text)
        if not matches:
            continue
        para_text = para.text
        placeholder_paras.append(para_text)
            
    return placeholder_paras





# >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

class UpdateEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="The placeholder name to be filled.")
    value: str = Field(..., description="The text value to insert for this placeholder.")
    order: conint(ge=1) = Field(
        ..., description="The same order index associated with this placeholder."
    )

class UpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(
        ...,
        description="A short summary."
    )
    updates: List[UpdateEntry] = Field(
        ...,
        description="Array of filled placeholders the model is confident about."
    )


def updatePlaceholders(message, ordered_placeholders, openai_api_key:str, conversation_history=None,):
    """
    Use OpenAI to intelligently update placeholders with values extracted from the message.
    If the model is not sure about any value, it should ask the user for clarification.
    Return a JSON object: {"message": str, "updates": dict}
    
    Args:
        message: The user's current message
        ordered_placeholders: List of placeholder dictionaries
        conversation_history: List of previous conversations in format [{"role": "user|assistant", "content": "..."}, ...]
    """
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set in environment")

    client = OpenAI(api_key=openai_api_key)

    # Compose prompt with all placeholder info + the user message
    prompt = """
    You are an expert in updating the document placeholders based on the user's message.
        If user want to update the placeholder, you update the placeholders based on the user's message and the conversation history.
        If there is any confusion ask the user for clarification.
        Respond to the user in appropriate manner if there is any changes make the summary
        """


    schema = UpdatePayload.model_json_schema()    
    placeholders_summary = "\n".join([
        f"- {pl['name']}: {pl['description']}" for pl in ordered_placeholders
    ])
    user_content = f"Placeholders: {placeholders_summary}\n\nUser message: {message}"
    
    # Build messages array with system prompt, conversation history, and current user message
    messages = [{"role": "system", "content": prompt}]
    
    # Add conversation history if available (already limited to last 15 from views.py)
    if conversation_history:
        # Add each conversation message to the messages array
        for conv in conversation_history:
            if isinstance(conv, dict) and "role" in conv and "content" in conv:
                # Ensure role is either "user" or "assistant"
                role = conv["role"]
                if role not in ["user", "assistant"]:
                    continue
                messages.append({
                    "role": role,
                    "content": conv["content"]
                })
    
    # Add the current user message
    messages.append({"role": "user", "content": user_content})
    
    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        temperature=0,
        messages=messages,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "update_placeholders", "schema": schema, "strict": True},
        },
    )
    
    content = resp.choices[0].message.content or "{}"
    try:
        UpdatePayload.model_validate_json(content)
    except ValidationError as ve:
        raise RuntimeError(f"Pydantic validation failed:\n{ve}\nRaw: {content}")
    content = json.loads(content)
    return content
    
