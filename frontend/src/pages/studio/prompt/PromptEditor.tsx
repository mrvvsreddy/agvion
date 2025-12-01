import { useState } from "react";
import { Sparkles, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import RichTextEditor from "@/components/RichTextEditor";

const PromptEditor = () => {
  const [instructions, setInstructions] = useState("");
  const [selectedModel, setSelectedModel] = useState("performance-optimized");

  return (
    <div className="flex flex-col h-full">
      {/* Action Buttons */}
      <div className="flex items-center gap-3 mb-4">
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="performance-optimized">Performance-optimized Model</SelectItem>
            <SelectItem value="balanced">Balanced Model</SelectItem>
            <SelectItem value="quality-focused">Quality-focused Model</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" className="gap-2 hover:bg-muted">
          <Sparkles className="w-4 h-4" />
          Refine with AI
        </Button>

        <Button variant="outline" className="gap-2 hover:bg-muted">
          <TestTube2 className="w-4 h-4" />
          Test agent
        </Button>
      </div>

      {/* Rich Text Editor */}
      <div className="flex-1 overflow-hidden">
        <RichTextEditor
          content={instructions}
          onChange={setInstructions}
          placeholder="Write instructions or '/' for tools and more..."
        />
      </div>
    </div>
  );
};

export default PromptEditor;
