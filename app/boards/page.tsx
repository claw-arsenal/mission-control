import { BoardsPageClient } from "@/components/tasks/boards/boards-page-client";
import { getBoardsPageData } from "@/lib/db/server-data";

export const dynamic = "force-dynamic";

// Note: getWorkspaceAssignees (runtime snapshot) is NOT called here — it uses
// execFileSync which blocks SSR. Assignees are loaded client-side instead.
export default async function BoardsPage() {
  const initialBoards = await getBoardsPageData();
  return <BoardsPageClient initialBoardId={null} initialBoards={initialBoards as never[]} initialAssignees={[] as never[]} sidebarUser={null} />;
}
