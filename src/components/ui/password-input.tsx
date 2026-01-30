import { useId, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "type"> & {
  labelShow?: string;
  labelHide?: string;
  showTextToggle?: boolean;
};

export function PasswordInput({ className, id, labelShow, labelHide, showTextToggle, ...props }: Props) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const [visible, setVisible] = useState(false);

  const ariaLabel = useMemo(() => {
    return visible ? (labelHide ?? "Ocultar senha") : (labelShow ?? "Mostrar senha");
  }, [labelHide, labelShow, visible]);

  return (
    <div className="relative">
      <Input
        id={inputId}
        type={visible ? "text" : "password"}
        className={cn(showTextToggle ? "pr-24" : "pr-10", className)}
        {...props}
      />
      <button
        type="button"
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1",
          "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "flex items-center gap-1 text-xs",
        )}
        aria-label={ariaLabel}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {showTextToggle ? <span>{visible ? "Ocultar" : "Mostrar"}</span> : null}
      </button>
    </div>
  );
}
