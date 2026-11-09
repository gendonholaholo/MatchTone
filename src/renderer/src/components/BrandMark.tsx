export function BrandMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="16" fill="#18181B" stroke="#27272A" strokeWidth="2" />
      <path d="M32 13C21.507 13 13 21.507 13 32C13 42.493 21.507 51 32 51V13Z" fill="#38BDF8" />
      <path d="M32 13C42.493 13 51 21.507 51 32C51 42.493 42.493 51 32 51V13Z" fill="#722ED1" />
      <circle cx="32" cy="32" r="9.5" fill="#09090B" fillOpacity="0.9" />
      <path d="M32 25C28.134 25 25 28.134 25 32C25 35.866 28.134 39 32 39V25Z" fill="#FAF5FF" />
      <path d="M32 25C35.866 25 39 28.134 39 32C39 35.866 35.866 39 32 39V25Z" fill="#A855F7" />
      <rect x="30.75" y="10" width="2.5" height="44" rx="1.25" fill="#FAF5FF" />
      <circle cx="32" cy="32" r="3.5" fill="#722ED1" stroke="#FAF5FF" strokeWidth="1.5" />
    </svg>
  );
}
