import { BoardsPageClient } from "@/components/tasks/boards/boards-page-client";
import { getBoardsPageData, getSidebarUser, getWorkspaceAssignees } from "@/lib/db/server-data";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BoardsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const boardParam = params.board;
  const requestedBoardId = Array.isArray(boardParam) ? boardParam[0] : boardParam ?? null;
  const [sidebarUser, initialBoards, initialAssignees] = await Promise.all([
    getSidebarUser(),
    getBoardsPageData(),
    getWorkspaceAssignees(),
  ]);
  const initialBoardId =
    requestedBoardId && initialBoards.some((board) => board.id === requestedBoardId)
      ? requestedBoardId
      : null;

  return (
    <BoardsPageClient
      initialBoardId={initialBoardId}
      initialBoards={initialBoards}
      initialAssignees={initialAssignees}
      sidebarUser={
        sidebarUser
          ? {
              name: sidebarUser.name,
              email: sidebarUser.email,
              avatar: sidebarUser.avatarUrl,
            }
          : null
      }
    />
  );
}
