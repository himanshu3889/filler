"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Box,
  TextField,
  IconButton,
  Typography,
  CircularProgress,
  InputAdornment,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import { sendAgentMessage } from "../services/documentService";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  updates?: UpdateEntry[];
}

interface ChatProps {
  documentId: string | null;
  openaiApiKey: string;
  onChatResponse?: (response: AgentMessageResponse) => void;
}

// Store chats in memory (per documentId)
const chatStore = new Map<string, ChatMessage[]>();

export default function Chat({ documentId, openaiApiKey, onChatResponse }: ChatProps) {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chats for current documentId using useMemo for optimization
  const currentChats = useMemo(() => {
    if (!documentId) return [];
    return chatStore.get(documentId) || [];
  }, [documentId]);

  // Update local state when documentId changes
  useEffect(() => {
    setChats(currentChats);
  }, [currentChats]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats]);

  const handleSend = async () => {
    if (!message.trim() || !documentId || !openaiApiKey || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: message.trim(),
      timestamp: new Date(),
    };

    // Add user message immediately
    const updatedChats = [...chats, userMessage];
    setChats(updatedChats);
    chatStore.set(documentId, updatedChats);
    setMessage("");
    setIsLoading(true);

    try {
      const response = await sendAgentMessage(documentId, userMessage.content, openaiApiKey);
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
        updates: response.updates,
      };

      const finalChats = [...updatedChats, assistantMessage];
      setChats(finalChats);
      chatStore.set(documentId, finalChats);

      // Call the callback with the response
      if (onChatResponse) {
        onChatResponse(response);
      }

      // Show success toast if updates were made
      if (response.updates && response.updates.length > 0) {
        toast.success("AI updated placeholders", {
          description: `${response.updates.length} placeholder(s) have been updated`,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      
      const errorChatMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      };

      const finalChats = [...updatedChats, errorChatMessage];
      setChats(finalChats);
      chatStore.set(documentId, finalChats);

      // Show error toast
      toast.error("Chat error", {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!documentId || !openaiApiKey) { 
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          p: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {!openaiApiKey ? "Please configure your OpenAI API key to use chat features." : "Upload a document to start chatting"}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          p: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <IconButton size="small" sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          AI Assistant
        </Typography>
      </Box>

      {/* Messages Area */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          p: 2,
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        {!documentId ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Upload a document to start chatting
            </Typography>
          </Box>
        ) : chats.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Start a conversation about your document
            </Typography>
          </Box>
        ) : (
          <>
            {chats.map((chat) => (
              <Box
                key={chat.id}
                sx={{
                  display: "flex",
                  justifyContent: chat.role === "user" ? "flex-end" : "flex-start",
                  width: "100%",
                }}
              >
                <Box
                  sx={{
                    maxWidth: "70%",
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor:
                      chat.role === "user"
                        ? "primary.dark"
                        : "grey.100",
                    color:
                      chat.role === "user"
                        ? "primary.contrastText"
                        : "text.primary",
                  }}
                >
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {chat.content}
                  </Typography>
                </Box>
              </Box>
            ))}
            {isLoading && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  width: "100%",
                }}
              >
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: "grey.100",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    Thinking...
                  </Typography>
                </Box>
              </Box>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      {/* Input Area */}
      <Box
        sx={{
          p: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder="Ask about placeholders..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={!documentId || !openaiApiKey || isLoading}
          variant="outlined"
          size="small"
          sx={{
            "& .MuiOutlinedInput-root": {
              bgcolor: "background.paper",
              pr: 0.5,
            },
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end" sx={{ alignSelf: "flex-end", mb: 0.5 }}>
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!documentId || !openaiApiKey || !message.trim() || isLoading}
                  size="small"
                  sx={{
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                    "&:hover": {
                      bgcolor: "primary.dark",
                    },
                    "&:disabled": {
                      bgcolor: "action.disabledBackground",
                      color: "action.disabled",
                    },
                  }}
                >
                  {isLoading ? (
                    <CircularProgress size={18} sx={{ color: "inherit" }} />
                  ) : (
                    <SendIcon fontSize="small" />
                  )}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>
    </Box>
  );
}

