export { 
    findWorkspaceRoot, 
    workspaceRoot, 
    ALLOWED_BUCKETS, 
    validatePath, 
    isReadOnly, 
    gitCommit 
} from "@context-os/core";

export function handleToolError(error: any, context?: string) {
  const message = error instanceof Error ? error.message : String(error);

  // Sanitize: remove absolute filesystem paths
  const sanitized = message.replace(/\/Users\/[^\s]+/g, '<workspace>');

  const prefix = context ? `[${context}] ` : '';

  return {
    content: [{ type: "text" as const, text: `${prefix}Error: ${sanitized}` }],
    isError: true
  };
}
