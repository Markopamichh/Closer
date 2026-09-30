import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

export function Preferences() {
  return (
    <div className="flex items-center gap-1">
      <LocaleSwitcher />
      <ThemeToggle />
    </div>
  );
}
