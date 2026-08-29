// Minimal hand-authored icon set — avoids pulling in an icon library for a couple dozen glyphs.
export type IconProps = { className?: string };

const base = "h-5 w-5";

export function HomeIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 8v4.2l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3.5 6.5a1 1 0 0 1 1-1H9l2 2.2h8.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6.5Z" strokeLinejoin="round" />
    </svg>
  );
}

export function MoreIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function ChevronRightIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChecklistIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="m8 8.2 1.3 1.3L11.8 7M8 15.2l1.3 1.3 2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 8.5h3.2M14.5 15.5h3.2" strokeLinecap="round" />
    </svg>
  );
}

export function UsersIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="9" cy="8.2" r="3.2" />
      <path d="M2.8 19.5c0-3.3 2.8-5.8 6.2-5.8s6.2 2.5 6.2 5.8" strokeLinecap="round" />
      <path d="M15.8 5.2a3.2 3.2 0 0 1 0 6" strokeLinecap="round" />
      <path d="M17.2 13.9c2.4.6 4 2.7 4 5.6" strokeLinecap="round" />
    </svg>
  );
}

export function MegaphoneIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3.5 10.2v3.6a1 1 0 0 0 1 1H6l1.3 4.6a1 1 0 0 0 1 .74h1.1a1 1 0 0 0 .96-1.28L9.3 14.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 10.2 14 6.3a1 1 0 0 1 1.35.94v9.06a1 1 0 0 1-1.35.94L3.5 13.8v-3.6Z" strokeLinejoin="round" />
      <path d="M18.5 9.5a3.3 3.3 0 0 1 0 5" strokeLinecap="round" />
    </svg>
  );
}

export function UserCircleIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="9.8" r="2.7" />
      <path d="M6.2 18.2c1.1-2.2 3.2-3.5 5.8-3.5s4.7 1.3 5.8 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function IdCardIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="2.8" y="5" width="18.4" height="14" rx="2" />
      <circle cx="8.3" cy="11.2" r="2" />
      <path d="M5.3 16c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3" strokeLinecap="round" />
      <path d="M14 9.5h4M14 12.7h4" strokeLinecap="round" />
    </svg>
  );
}

export function ChartIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3.5 20.5h17" strokeLinecap="round" />
      <path d="M6.5 20.5v-6M12 20.5V7M17.5 20.5v-9.5" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="3.1" />
      <path
        d="M12 3.6v2M12 18.4v2M20.4 12h-2M5.6 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronDownIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 3.5v11.3M8 11.3l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 16.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckCircleIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.3 2.4 2.4 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArchiveIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="4" width="18" height="4.2" rx="1" />
      <path d="M4.5 8.2V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.8 12.5h4.4" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m20 20-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

export function MailIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 6.5 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PhoneIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        d="M6.6 3.5h2.2l1.3 4-1.9 1.5a11.5 11.5 0 0 0 4.8 4.8l1.5-1.9 4 1.3v2.2a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 7 7.3 19a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L18 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.2 11v6M13.8 11v6" strokeLinecap="round" />
    </svg>
  );
}

export function LogOutIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M9 20.5H5.5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1H9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" strokeLinecap="round" />
    </svg>
  );
}

export function GraduationCapIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z" strokeLinejoin="round" />
      <path d="M6.5 11v4.2c0 1.1 2.5 2.3 5.5 2.3s5.5-1.2 5.5-2.3V11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5 9v5.5" strokeLinecap="round" />
    </svg>
  );
}
