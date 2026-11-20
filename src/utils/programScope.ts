/** The programs a viewer may see: a manager or faculty member is bound to
 *  the single program assigned on their profile; admins see the full list.
 *  Structural on purpose — pages pass either a full Profile or the small
 *  { role, program_id } slice their props already carry. */
export interface ProgramScope {
  role?: string | null
  program_id?: string | null
}

export function visiblePrograms<T extends { id: string }>(programs: T[], viewer?: ProgramScope | null): T[] {
  if (viewer?.role === 'manager' || viewer?.role === 'user') {
    // An assigned role never gets another program's list. With no
    // assignment there is nothing to show — the page says so.
    return viewer.program_id ? programs.filter((p) => p.id === viewer.program_id) : []
  }
  return programs
}
