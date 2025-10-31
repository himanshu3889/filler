"use client";

import React, { useEffect, useRef, useState } from "react";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module.js";
import { saveAs } from "file-saver";
import { renderAsync } from "docx-preview";
import {
  AppBar,
  Toolbar,
  IconButton,
  Box,
  Button,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField,
  Typography,
  Divider,
  Drawer,
  Tabs,
  Tab,
  Tooltip,
  Badge,
  LinearProgress,
  Stack,
  useMediaQuery,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import EditNoteIcon from "@mui/icons-material/EditNote";
import DownloadIcon from "@mui/icons-material/Download";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckIcon from "@mui/icons-material/Check";
import SettingsIcon from "@mui/icons-material/Settings";
import { useTheme } from "@mui/material/styles";

import Chat from "./Chat";
import { uploadFile, updatePlaceholders } from "@/services/documentService";
import { toast } from "sonner";

/** Helpers */
const DELIMS = { start: "[", end: "]" };

type Placeholder = { name: string; description: string; value: string };
type AgentMessageResponse = { updates: { name?: string; order?: number; value: string }[] };

function renameDocxByOccurrence(arrayBuffer: ArrayBuffer, orderedNewNames: string[]): ArrayBuffer {
  const zip = new PizZip(arrayBuffer);
  let idx = 0;
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: DELIMS,
    parser() {
      return {
        get() {
          const next = orderedNewNames[idx] ?? `placeholder_${String(idx + 1).padStart(3, "0")}`;
          idx += 1;
          return `${DELIMS.start}${next}${DELIMS.end}`;
        },
      };
    },
    nullGetter(part: any) {
      const t = part?.tag ?? "";
      return `${DELIMS.start}${t}${DELIMS.end}`;
    },
  });
  doc.render({});
  return doc.getZip().generate({ type: "arraybuffer" }) as ArrayBuffer;
}

const API_KEY_STORAGE_KEY = "openai_api_key";

export default function DocPlaceholderEditor() {
  const [placeholders, setPlaceholders] = useState<Record<string, Placeholder>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [orderedNames, setOrderedNames] = useState<string[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // NEW: staged, per-field drafts
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  // API Key management
  const [openaiApiKey, setOpenaiApiKey] = useState<string>("");
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");

  // Responsive
  const theme = useTheme();
  const isSmDown = useMediaQuery(theme.breakpoints.down("sm"));
  const isMdDown = useMediaQuery(theme.breakpoints.down("md"));
  const drawerWidth = isMdDown ? "100%" : 420;
  const appBarHeight = isSmDown ? 56 : 64;

  // Load API key from localStorage on mount
  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedKey) {
      setOpenaiApiKey(storedKey);
      setApiKeyInput(storedKey);
    } else {
      // Show dialog if no API key exists
      setApiKeyDialogOpen(true);
    }
  }, []);

  useEffect(() => {
    const setVh = () =>
      document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  // Handle API key dialog
  const handleApiKeySave = () => {
    const trimmedKey = apiKeyInput.trim();
    if (!trimmedKey) {
      toast.error("Invalid API key", {
        description: "Please enter a valid OpenAI API key",
      });
      return; // Don't save empty keys
    }
    setOpenaiApiKey(trimmedKey);
    localStorage.setItem(API_KEY_STORAGE_KEY, trimmedKey);
    setApiKeyDialogOpen(false);
    toast.success("API key saved", {
      description: "Your OpenAI API key has been saved locally",
    });
  };

  const handleApiKeyDialogOpen = () => {
    setApiKeyInput(openaiApiKey);
    setApiKeyDialogOpen(true);
  };

  const handleApiKeyDialogClose = () => {
    // Only allow closing if API key already exists
    if (openaiApiKey) {
      setApiKeyDialogOpen(false);
      setApiKeyInput(openaiApiKey);
    }
  };

  // UI state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<0 | 1>(0);

  /** Upload + AI rename */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    
    // Check if API key is set
    if (!openaiApiKey) {
      setApiKeyDialogOpen(true);
      if (event.target) event.target.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const file = event.target.files[0];
      setFileName(file.name);
      const originalArrayBuffer = await file.arrayBuffer();

      let res: UploadFileResponse;
      try{
        res = await uploadFile(file, openaiApiKey);
      } catch (error) { 
        toast.info("Looks like server is down due to free tier usage.", {
          description: "This may take up to 1 minute on first upload. Please wait.",
          duration: 60000, // 1 minute
        });
        await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 1 minute
        res = await uploadFile(file, openaiApiKey);
      }
      const { placeholders: phFromAPI, document_id } = res;
      setDocumentId(document_id);

      const orderedNewNames: string[] = (phFromAPI || []).map((s: any) => s.name);
      setOrderedNames(orderedNewNames);

      const descByName: Record<string, string> = Object.fromEntries(
        (phFromAPI || []).map((s: any) => [s.name, s.description || ""]),
      );

      const renamedBuffer = renameDocxByOccurrence(originalArrayBuffer, orderedNewNames);
      setTemplateBuffer(renamedBuffer);

      // Inspect tags to seed UI
      const zip = new PizZip(renamedBuffer);
      const inspectModule = new InspectModule();
      new Docxtemplater(zip, {
        modules: [inspectModule],
        paragraphLoop: true,
        linebreaks: true,
        delimiters: DELIMS,
      });
      const tags = inspectModule.getAllTags() || {};
      const extracted: Record<string, Placeholder> = {};
      Object.keys(tags).forEach((key) => {
        extracted[key] = { name: key, description: descByName[key] ?? "", value: "" };
      });
      setPlaceholders(extracted);

      // seed drafts from placeholders
      setDraftValues(
        Object.fromEntries(Object.entries(extracted).map(([k, ph]) => [k, ph.value ?? ""]))
      );

      setDrawerTab(0);
      setDrawerOpen(true);
      toast.success("File uploaded successfully!", {
        description: `Found ${Object.keys(extracted).length} placeholder(s)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload file";
      toast.error("Upload failed", {
        description: errorMessage,
      });
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = "";
    }
  };

  const totalCount = Object.keys(placeholders).length;
  const filledCount = Object.values(placeholders).filter((p) => (p?.value ?? "").trim() !== "")
    .length;

  /** Create filled buffer for preview/download */
  const generateFilledArrayBuffer = (): ArrayBuffer | null => {
    if (!templateBuffer) return null;
    const data: Record<string, string> = {};
    Object.entries(placeholders).forEach(([tag, ph]) => {
      const val = (ph?.value ?? "").toString();
      data[tag] = val.trim() !== "" ? val : `${DELIMS.start}${tag}${DELIMS.end}`;
    });
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: DELIMS,
        parser(tag: any) {
          return { get(scope: Record<string, string>) { return scope[tag]; } };
        },
        nullGetter(part: any) {
          const t = part?.tag ?? "";
          return `${DELIMS.start}${t}${DELIMS.end}`;
        },
      });
      doc.render(data);
      return doc.getZip().generate({ type: "arraybuffer" }) as ArrayBuffer;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Failed to generate preview";
      toast.error("Preview error", {
        description: errorMessage,
      });
      return null;
    }
  };

  useEffect(() => {
    if (!previewRef.current || !templateBuffer) return;
    previewRef.current.innerHTML = "";
    const filled = generateFilledArrayBuffer();
    if (!filled) return;

    renderAsync(filled, previewRef.current, undefined, {
      className: "docx-preview",
      inWrapper: true,
      ignoreFonts: false,
      breakPages: false,
      renderHeaders: true,
      renderFooters: true,
    }).catch((e) => {
      const errorMessage = e instanceof Error ? e.message : "Failed to render preview";
      toast.error("Preview render error", {
        description: errorMessage,
      });
    });
  }, [templateBuffer, placeholders]);

  const handleDownload = () => {
    if (!templateBuffer) return;
    const data: Record<string, string> = {};
    Object.entries(placeholders).forEach(([tag, ph]) => {
      const val = (ph?.value ?? "").toString();
      if (val.trim() !== "") data[tag] = val;
    });
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: DELIMS,
      parser(tag: any) { return { get(scope: Record<string, string>) { return scope[tag]; } }; },
      nullGetter(part: any) {
        const t = part?.tag ?? "";
        return `${DELIMS.start}${t}${DELIMS.end}`;
      },
    });
    try {
      doc.render(data);
      const out = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      saveAs(out, fileName ? fileName.replace(/\.docx$/i, "-filled.docx") : "document-filled.docx");
      toast.success("Document downloaded", {
        description: "Your completed document has been downloaded",
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Failed to generate document";
      toast.error("Download failed", {
        description: errorMessage,
      });
    }
  };

  /** Apply AI updates */
  type StructuredUpdate = { name?: string; order?: number; value: string };
  const applyStructuredUpdates = (updates: StructuredUpdate[]) => {
    if (!updates?.length) return;
    setPlaceholders((prev) => {
      const next = { ...prev };
      updates.forEach((u) => {
        let key = u.name?.trim();
        if (!key && typeof u.order === "number") {
          const idx = u.order - 1;
          if (idx >= 0 && idx < orderedNames.length) key = orderedNames[idx];
        }
        if (!key || !next[key]) return;
        next[key] = { ...next[key], value: u.value ?? "" };
      });
      return next;
    });
  };

  // ---------- New per-field apply logic ----------
  // draft change
  const onDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDraftValues((prev) => ({ ...prev, [name]: value }));
  };

  // Is this field changed vs committed placeholder?
  const isDirty = (name: string) => (draftValues[name] ?? "") !== (placeholders[name]?.value ?? "");

  // Apply a single field (✓)
  const applyOne = async (name: string) => {
    const value = draftValues[name] ?? "";
    
    // Update local state immediately for responsive UI
    applyStructuredUpdates([{ name, value }]);
    setDraftValues((prev) => ({ ...prev, [name]: value }));
    
    // Sync to backend if documentId is available
    if (documentId) {
      try {
        await updatePlaceholders(documentId, [{ name, value }]);
        toast.success("Placeholder updated", {
          description: `${name} has been saved`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to update placeholder";
        toast.error("Update failed", {
          description: errorMessage,
        });
      }
    }
  };

  // When placeholders change externally (AI tab), reflect them in drafts for a consistent UI
  useEffect(() => {
    setDraftValues((prev) => {
      const merged: Record<string, string> = { ...prev };
      Object.entries(placeholders).forEach(([k, ph]) => {
        // If not dirty, sync from committed
        if (!prev.hasOwnProperty(k) || !isDirty(k)) {
          merged[k] = ph.value ?? "";
        }
      });
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholders]);

  // UI handlers
  const toggleDrawer = (open?: boolean) => () =>
    setDrawerOpen((v) => (typeof open === "boolean" ? open : !v));
  const onTabChange = (_: React.SyntheticEvent, v: number) => setDrawerTab(v as 0 | 1);

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top App Bar */}
      <AppBar position="sticky" elevation={1} color="default">
        <Toolbar sx={{ gap: 1 }}>
          <DescriptionIcon sx={{ mr: 1 }} />
          <Typography
            variant={isSmDown ? "subtitle1" : "h6"}
            sx={{ flexGrow: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            AI Document Placeholder Filler
          </Typography>

          {/* Actions: icons on phones, buttons on larger screens */}
          {isSmDown ? (
            <>
              <Tooltip title="OpenAI API Settings">
                <IconButton onClick={handleApiKeyDialogOpen} size="large">
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Upload .docx">
                <span>
                  <IconButton component="label" disabled={isUploading || !openaiApiKey} size="large">
                    <UploadFileIcon />
                    <input hidden type="file" accept=".docx" onChange={handleFileUpload} />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title={templateBuffer ? "Fill placeholders / Talk to AI" : "Upload a .docx first"}>
                <span>
                  <Badge
                    color={filledCount === totalCount && totalCount > 0 ? "success" : "primary"}
                    badgeContent={totalCount ? `${filledCount}/${totalCount}` : 0}
                    overlap="circular"
                    sx={{ mr: 0.5 }}
                  >
                    <IconButton disabled={!templateBuffer} onClick={toggleDrawer(true)} size="large">
                      <EditNoteIcon />
                    </IconButton>
                  </Badge>
                </span>
              </Tooltip>

              <Tooltip title={templateBuffer ? "Download Completed DOCX" : "Upload a .docx first"}>
                <span>
                  <IconButton
                    disabled={!templateBuffer || totalCount === 0}
                    onClick={handleDownload}
                    size="large"
                  >
                    <DownloadIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip title="OpenAI API Settings">
                <Button
                  variant="outlined"
                  startIcon={<SettingsIcon />}
                  onClick={handleApiKeyDialogOpen}
                  sx={{ mr: 1 }}
                >
                  API Key
                </Button>
              </Tooltip>
              <Tooltip title="Upload .docx">
                <Button
                  variant="outlined"
                  startIcon={<UploadFileIcon />}
                  component="label"
                  disabled={isUploading || !openaiApiKey}
                  sx={{ mr: 1 }}
                >
                  Upload
                  <input hidden type="file" accept=".docx" onChange={handleFileUpload} />
                </Button>
              </Tooltip>

              <Tooltip title={templateBuffer ? "Fill placeholders / Talk to AI" : "Upload a .docx first"}>
                <span>
                  <Badge
                    color={filledCount === totalCount && totalCount > 0 ? "success" : "primary"}
                    badgeContent={totalCount ? `${filledCount}/${totalCount}` : 0}
                    overlap="circular"
                    sx={{ mr: 1 }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<EditNoteIcon />}
                      disabled={!templateBuffer}
                      onClick={toggleDrawer(true)}
                    >
                      Fill
                    </Button>
                  </Badge>
                </span>
              </Tooltip>

              <Tooltip title={templateBuffer ? "Download Completed DOCX" : "Upload a .docx first"}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    disabled={!templateBuffer || totalCount === 0}
                    onClick={handleDownload}
                  >
                    Download
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </Toolbar>
        {isUploading && <LinearProgress />}
      </AppBar>

      {/* Main content: full-screen preview area with safe 100vh */}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          bgcolor: "background.default",
          height: `calc((var(--vh, 1vh) * 100) - ${appBarHeight}px)`,
        }}
      >
        {!templateBuffer ? (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              p: 2,
            }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, maxWidth: 560, width: "100%", textAlign: "center" }}>
              <Typography variant="h6" gutterBottom>
                Upload a .docx template
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                We’ll auto-detect placeholders, let you fill them, and show a live preview.
              </Typography>
              <Button
                size="large"
                fullWidth={isSmDown}
                variant="contained"
                startIcon={<UploadFileIcon />}
                component="label"
                disabled={isUploading || !openaiApiKey}
              >
                Choose .docx
                <input hidden type="file" accept=".docx" onChange={handleFileUpload} />
              </Button>
            </Paper>
          </Box>
        ) : (
          <Box
            ref={previewRef}
            sx={{
              position: "absolute",
              inset: 0,
              overflow: "auto",
              py: { xs: 1, sm: 2 },
              px: { xs: 0.5, sm: 2 },
              WebkitOverflowScrolling: "touch",
              "& .docx-preview": { m: "0 auto" },
              "& .docx": { maxWidth: "100%" },
            }}
          />
        )}
      </Box>

      {/* Left Drawer: responsive */}
      <Drawer
        anchor="left"
        variant="temporary"
        open={drawerOpen}
        onClose={toggleDrawer(false)}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: drawerWidth, display: "flex", flexDirection: "column" } }}
      >
        <Box sx={{ px: 2, pt: 1, pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Fill Document
            </Typography>
            <IconButton onClick={toggleDrawer(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>

          <Tabs
            value={drawerTab}
            onChange={onTabChange}
            aria-label="Fill or Talk to AI"
            variant={isSmDown ? "fullWidth" : "scrollable"}
            scrollButtons={isSmDown ? false : "auto"}
            allowScrollButtonsMobile
            sx={{ mt: 1 }}
          >
            <Tab icon={<EditNoteIcon />} iconPosition="start" label="Placeholders" />
            <Tab icon={<ChatBubbleOutlineIcon />} iconPosition="start" label="Talk to AI" />
          </Tabs>
        </Box>

        <Divider />

        <Box sx={{ flex: 1, overflow: "hidden" }}>
          {drawerTab === 0 && (
            <Box sx={{ height: "100%", overflow: "auto", p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Placeholders
              </Typography>
              <List dense disablePadding>
                {totalCount === 0 && (
                  <ListItem>
                    <ListItemText primary="No placeholders detected yet." />
                  </ListItem>
                )}
                {Object.entries(placeholders).map(([key, ph]) => {
                  const dirty = isDirty(ph.name);
                  return (
                    <ListItem key={key} sx={{ alignItems: "flex-start", px: 0 }}>
                      <Box sx={{ width: "100%" }}>
                        <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
                          {ph.name}
                        </Typography>
                        {ph.description && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {ph.description}
                          </Typography>
                        )}
                        <TextField
                          fullWidth
                          size="small"
                          margin="dense"
                          placeholder="Enter value"
                          name={ph.name}
                          value={draftValues[ph.name] ?? ""}
                          onChange={onDraftChange}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && dirty) {
                              e.preventDefault();
                              applyOne(ph.name);
                            }
                          }}
                          autoComplete="off"
                          // make focus styles use primary when dirty
                          color={dirty ? "primary" : undefined}
                          // force the outline to tint primary while dirty (even when not focused)
                          sx={{
                            "& .MuiOutlinedInput-root": {
                              "& .MuiOutlinedInput-notchedOutline": {
                                borderColor: dirty ? "primary.main" : undefined,
                              },
                              "&:hover .MuiOutlinedInput-notchedOutline": {
                                borderColor: dirty ? "primary.main" : undefined,
                              },
                            },
                            // OPTIONAL: subtle background to hint “unsaved”
                            "& .MuiInputBase-input": {
                              backgroundColor: dirty ? "action.hover" : "transparent",
                              transition: "background-color 120ms ease",
                            },
                          }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Tooltip title={dirty ? "Apply" : "No changes"}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() => applyOne(ph.name)}
                                      disabled={!dirty}
                                      edge="end"
                                      // tint the check icon primary while there are unsaved edits
                                      color={dirty ? "primary" : "default"}
                                    >
                                      <CheckIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                Filled {filledCount}/{totalCount}
              </Typography>

              <Box sx={{ mt: 2 }}>
                <Button
                  fullWidth
                  variant="contained"
                  disabled={!templateBuffer || totalCount === 0}
                  onClick={handleDownload}
                  startIcon={<DownloadIcon />}
                >
                  Download Completed DOCX
                </Button>
              </Box>
            </Box>
          )}

          {drawerTab === 1 && (
            <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1">Talk to AI</Typography>
                <Typography variant="body2" color="text.secondary">
                  Ask AI to extract or generate values, then we’ll auto-fill the matching placeholders.
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
                <Chat
                  documentId={documentId}
                  openaiApiKey={openaiApiKey}
                  onChatResponse={(response: AgentMessageResponse) => {
                    applyStructuredUpdates(response.updates); // commit
                    // also reflect in drafts
                    setDraftValues((prev) => {
                      const next = { ...prev };
                      response.updates.forEach((u) => {
                        let k = u.name?.trim();
                        if (!k && typeof u.order === "number") {
                          const idx = u.order - 1;
                          if (idx >= 0 && idx < orderedNames.length) k = orderedNames[idx];
                        }
                        if (k) next[k] = u.value ?? "";
                      });
                      return next;
                    });
                  }}
                />
              </Box>
            </Box>
          )}
        </Box>
      </Drawer>

      {/* API Key Dialog */}
      <Dialog
        open={apiKeyDialogOpen}
        onClose={handleApiKeyDialogClose}
        aria-labelledby="api-key-dialog-title"
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown={!openaiApiKey}
      >
        <DialogTitle id="api-key-dialog-title">
          {openaiApiKey ? "Edit OpenAI API Key" : "OpenAI API Key Required"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {openaiApiKey
              ? "Update your OpenAI API key. This key is stored locally in your browser and used for document processing and AI chat."
              : "Please enter your OpenAI API key to continue. This key will be stored locally in your browser and is required for uploading documents and using AI features."}
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            id="api-key"
            label="OpenAI API Key"
            type="password"
            fullWidth
            variant="outlined"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-..."
            sx={{ mt: 2 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKeyInput.trim()) {
                handleApiKeySave();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          {openaiApiKey && (
            <Button onClick={handleApiKeyDialogClose}>Cancel</Button>
          )}
          <Button
            onClick={handleApiKeySave}
            variant="contained"
            disabled={!apiKeyInput.trim()}
          >
            {openaiApiKey ? "Update" : "Save & Continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}