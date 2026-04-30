export { 
    findWorkspaceRoot, 
    workspaceRoot, 
    ALLOWED_BUCKETS, 
    validatePath, 
    isReadOnly, 
    gitCommit 
} from "@context-os/core";

export function handleToolError(error: any) {
  return {
    content: [{ type: "text" as const, text: `Error: ${error.message}` }],
    isError: true
  };
}
