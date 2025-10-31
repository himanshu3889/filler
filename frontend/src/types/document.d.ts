interface Placeholder {
    order: number;
    name: string;
    description: string;
  }


  interface UploadFileResponse {
    document_id: string;
    filename: string;
    message: string;
    placeholders: Placeholder[];
  }
  
  interface UpdateEntry {
    name: string;
    value: string;
    order: number;
  }
  
  interface AgentMessageResponse {
    message: string;
    updates: UpdateEntry[];
  }
  