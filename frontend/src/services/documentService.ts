const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://filler-h68p.onrender.com";



/**
 * Upload a DOCX file to the backend for processing
 * Returns document info with extracted placeholders
 */
export async function uploadFile(file: File, openaiApiKey: string): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('openai_api_key', openaiApiKey);
  const response = await fetch(`${API_BASE_URL}/api/fileUpload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Send a message to the AI agent about a document
 * Returns AI response with placeholder updates or clarification questions
 */
export async function sendAgentMessage(
  documentId: string,
  message: string,
  openaiApiKey: string
): Promise<AgentMessageResponse> {
  const response = await fetch(`${API_BASE_URL}/api/agent/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: documentId,
      message: message,
      openai_api_key: openaiApiKey,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Update placeholder values in a document
 * Takes an array of updates with name and value
 */
export async function updatePlaceholders(
  documentId: string,
  updates: Array<{ name: string; value: string }>
): Promise<{ document_id: string; filename: string; placeholders: any[] }> {
  const response = await fetch(`${API_BASE_URL}/api/updatePlaceholders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: documentId,
      updates: updates,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Update failed' }));
    throw new Error(error.error || `Update failed: ${response.statusText}`);
  }

  return response.json();
}

