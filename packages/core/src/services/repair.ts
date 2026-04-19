import fs from "fs-extra";
import path from "path";

export class SelfRepairService {
  /**
   * Attempts to repair a file if it fails validation.
   * Focuses on structurally normalizing the file so it meets ContextOS schema requirements.
   */
  public async attemptRepair(filePath: string, issues: string[]): Promise<boolean> {
    console.log(`🔧 Attempting autonomous repair for: ${filePath}`);
    
    try {
      const content = await fs.readFile(filePath, "utf-8");
      let repairedContent = content;

      // Rule-based logic (Phase A)
      if (issues.some(i => i.includes("required property 'status'") || i.includes("required property 'tags'"))) {
        if (!content.trim().startsWith("---")) {
          const title = path.basename(filePath, ".md");
          repairedContent = `---\ntitle: "${title}"\nstatus: active\npriority: medium\ntags: []\n---\n\n${content.trim()}`;
        }
      }

      if (issues.some(i => i.includes("required property 'title'"))) {
        if (!repairedContent.includes("# ")) {
          const title = path.basename(filePath, ".md");
          repairedContent = `# ${title}\n\n${repairedContent}`;
        }
      }

      // Agentic Fallback (Phase B)
      if (repairedContent === content) {
        console.log(`🧠 Rule-based repair failed. Spawning Janitor Agent for ${filePath}...`);
        try {
          repairedContent = await this.agentRepair(filePath, content, issues);
        } catch (err) {
          console.error(`❌ Janitor Agent failed:`, err);
          return false;
        }
      }

      if (repairedContent !== content) {
        await fs.writeFile(filePath, repairedContent, "utf-8");
        console.log(`✅ Successfully repaired ${filePath}`);
        return true;
      }
    } catch (error) {
      console.error(`❌ Repair failed for ${filePath}:`, error);
    }

    return false;
  }

  /**
   * Spawns a Janitor Agent to reconstruct malformed context files.
   */
  private async agentRepair(filePath: string, content: string, issues: string[]): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing for agentic repair.");

    const prompt = `
      You are the ContextOS Janitor Agent. 
      The file "${filePath}" failed validation:
      ${issues.map(i => `- ${i}`).join("\n")}

      CURRENT CONTENT:
      \`\`\`
      ${content}
      \`\`\`

      TASK:
      Repair the file content to solve the validation issues while preserving all human-written intent.
      Fix frontmatter, headers, and structural integrity.
      Return ONLY the corrected file content. No conversation. No markdown code blocks.
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    const repaired = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!repaired) {
      throw new Error(`Gemini Error: ${JSON.stringify(data.error || "No response candidate")}`);
    }

    return repaired.trim();
  }
}

export const repairService = new SelfRepairService();
