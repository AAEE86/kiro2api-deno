import type { ToolExecution } from "../types/common.ts";

export class ToolLifecycleManager {
  private activeTools = new Map<string, ToolExecution>();
  private completedTools = new Map<string, ToolExecution>();

  startTool(id: string, name: string, input: any): void {
    this.activeTools.set(id, {
      id,
      name,
      input,
      status: "running",
    });
  }

  completeTool(id: string, output?: any): void {
    const tool = this.activeTools.get(id);
    if (tool) {
      tool.status = "completed";
      tool.output = output;
      this.completedTools.set(id, tool);
      this.activeTools.delete(id);
    }
  }

  errorTool(id: string, error: string): void {
    const tool = this.activeTools.get(id);
    if (tool) {
      tool.status = "error";
      tool.error = error;
      this.completedTools.set(id, tool);
      this.activeTools.delete(id);
    }
  }

  getActiveTool(id: string): ToolExecution | undefined {
    return this.activeTools.get(id);
  }

  getCompletedTool(id: string): ToolExecution | undefined {
    return this.completedTools.get(id);
  }

  getAllActiveTools(): ToolExecution[] {
    return Array.from(this.activeTools.values());
  }

  getAllCompletedTools(): ToolExecution[] {
    return Array.from(this.completedTools.values());
  }

  hasActiveTools(): boolean {
    return this.activeTools.size > 0;
  }

  reset(): void {
    this.activeTools.clear();
    this.completedTools.clear();
  }
}