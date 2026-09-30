/**
 * The triangle mark from ui.html:113-117.
 *
 * Shared by the navbar and the footer so the wordmark is identical in both
 * places. The gold wash and lift are `group-hover` driven, so the parent
 * element must carry the `group` class for them to fire.
 */
export function BrandMark() {
  return (
    <div className="w-10 h-10 rounded-xl bg-noir flex items-center justify-center shadow-md relative overflow-hidden group-hover:border group-hover:border-gold/60 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-tr from-noir via-noir to-gold/25 opacity-0 group-hover:opacity-100 transition-opacity" />
      <svg
        className="w-5 h-5 text-gold relative z-10 transition-transform duration-300 group-hover:scale-105"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <polygon points="12 2 2 22 22 22" strokeLinecap="round" strokeLinejoin="round" />
        <line stroke="#E5C77D" strokeWidth={1.6} x1="7" x2="17" y1="14" y2="14" />
        <circle cx="12" cy="9" fill="#C9A45C" r="1.5" stroke="none" />
      </svg>
    </div>
  )
}
