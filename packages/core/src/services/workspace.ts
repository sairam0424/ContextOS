import fs from "fs-extra";
import path from "path";
import { getWorkspaceRoot } from "../context.js";
import { globalIndexer } from "../indexer.js";

export class WorkspaceService {
  /**
   * Synchronizes workspace context and updates metadata.
   */
  async sync(project?: string, options: { force?: boolean } = {}): Promise<{ success: boolean; message: string }> {
    const workspaceRoot = getWorkspaceRoot();
    const date = new Date().toISOString().split("T")[0];
    
    if (project) {
      const projectDir = path.join(workspaceRoot, "projects", project);
      const memoryPath = path.join(projectDir, "memory.md");
      
      if (await fs.pathExists(memoryPath)) {
        let content = await fs.readFile(memoryPath, "utf-8");
        const syncMark = `\n> [!NOTE]\n> Last Sync: ${date} ${new Date().toLocaleTimeString()}\n`;
        
        if (!content.includes("Last Sync:")) {
          await fs.appendFile(memoryPath, syncMark);
        } else {
          content = content.replace(/> \[!NOTE\]\n> Last Sync: .*/, syncMark.trim());
          await fs.writeFile(memoryPath, content);
        }
      } else {
        return { success: false, message: `Memory file not found for ${project}` };
      }
    }
    
    // Auto-refresh the intelligence index as part of sync (v1.4: Incremental by default)
    await globalIndexer.reindex({ force: options.force });
    
    return { 
      success: true, 
      message: project 
        ? `Synced memory for ${project} and refreshed index (incremental).` 
        : `Workspace indexed (${options.force ? 'full re-scan' : 'incremental'}).` 
    };
  }

  /**
   * Initializes a new workspace or project.
   */
  async init(projectName: string, options: { template?: string } = {}): Promise<void> {
    // Logic for init will go here in Phase 2
  }
}

export const workspaceService = new WorkspaceService();
