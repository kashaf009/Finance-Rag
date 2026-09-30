/**
 * Ambient background layers from ui.html:101-103.
 *
 * Light variant sits under the ivory landing hero; dark variant backs the
 * noir chat surface. Both are fixed, non-interactive and behind all content.
 */
export function AmbientLight() {
  return (
    <>
      <div className="fixed inset-0 bg-rag-grid pointer-events-none z-0" aria-hidden />
      <div
        className="fixed -top-40 right-[-10%] w-[680px] h-[680px] bg-gradient-to-b from-gold/10 via-gold/5 to-transparent rounded-full blur-3xl pointer-events-none z-0"
        aria-hidden
      />
      <div
        className="fixed bottom-0 -left-20 w-[600px] h-[600px] bg-gradient-to-t from-noir/[0.03] to-transparent rounded-full blur-2xl pointer-events-none z-0"
        aria-hidden
      />
    </>
  )
}

/** Gold bloom from the top edge — mirrors ui.html:317 on the dark section. */
export function AmbientDark() {
  return (
    <div
      className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,164,92,0.12),transparent_70%)] pointer-events-none"
      aria-hidden
    />
  )
}
