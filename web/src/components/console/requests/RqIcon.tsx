// Icons for the order request screens (Queue, Resolve, Thread): Lucide, through react-icons. One stroke set for these
// screens, in currentColor; the rest of the portal keeps its own <Icon/>.
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCircleAlert,
  LuCircleCheck,
  LuClock,
  LuCopy,
  LuInbox,
  LuInfo,
  LuMail,
  LuMinus,
  LuPackage,
  LuPlus,
  LuSearch,
  LuSend,
  LuUndo2,
  LuWarehouse,
} from "react-icons/lu";

const ICONS = {
  check: LuCheck,
  checkCircle: LuCircleCheck,
  alert: LuCircleAlert,
  mail: LuMail,
  clock: LuClock,
  chevron: LuChevronDown,
  chevR: LuChevronRight,
  minus: LuMinus,
  plus: LuPlus,
  search: LuSearch,
  copy: LuCopy,
  send: LuSend,
  box: LuPackage,
  info: LuInfo,
  inbox: LuInbox,
  undo: LuUndo2,
  warehouse: LuWarehouse,
};

export type RqIconName = keyof typeof ICONS;

export default function RqIcon({ name, className }: { name: RqIconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className ? `rq-ico ${className}` : "rq-ico"} strokeWidth={1.75} aria-hidden="true" />;
}
