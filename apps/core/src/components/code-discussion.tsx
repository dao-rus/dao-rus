import { CodeDiscussionDetails } from "./code-discussion-details";
import Link from "next/link";
import { LocalDateTime } from "./local-date-time";
import { ParticipantName } from "./participant-name";
import { sortCodeCommentReplies, sortCodeCommentRoots, type CodeComment, type CodeSection, type CodeSort } from "../lib/code-comments";
import { UserText } from "./user-text";

type DiscussionProps = {
  section: CodeSection;
  comments: CodeComment[];
  sort: CodeSort;
  viewerId: string | null;
  isAdmin: boolean;
  initiallyOpen: boolean;
};

function CommentCard({ comment, replies, section, viewerId, isAdmin }: {
  comment: CodeComment; replies: CodeComment[]; section: CodeSection;
  viewerId: string | null; isAdmin: boolean;
}) {
  const active = !comment.deleted && !comment.hidden;
  return (
    <li className={comment.parentId ? "codeComment codeReply" : "codeComment"} id={`comment-${comment.id}`}>
      <div className="codeCommentMeta">
        <ParticipantName participantId={comment.authorId}
          awardBadges={comment.awardBadges}
          verificationPoints={comment.verificationPoints} positiveCount={comment.positiveCount}>{comment.authorName}</ParticipantName>
        <LocalDateTime value={comment.createdAt.toISOString()} />
        {comment.pinned ? <span className="codePinned">Закреплено</span> : null}
        {comment.updatedAt.getTime() > comment.createdAt.getTime() && active
          ? <span className="muted">изменено</span> : null}
      </div>
      {comment.deleted ? <p className="muted">Комментарий удалён автором.</p>
        : comment.hidden ? <p className="muted">Комментарий скрыт администратором. Причина: {comment.hiddenReason}</p>
          : <UserText className="codeCommentBody" text={comment.body ?? ""} />}
      {active ? (
        <div className="codeCommentActions">
          <span>Полезно: {comment.helpfulCount}</span>
          {viewerId && viewerId !== comment.authorId ? (
            <form action="/api/code/comments" method="post">
              <input type="hidden" name="action" value="helpful" />
              <input type="hidden" name="section" value={section} />
              <input type="hidden" name="comment_id" value={comment.id} />
              <button type="submit" aria-pressed={comment.helpedByViewer}>
                {comment.helpedByViewer ? "Снять отметку" : "Полезно"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {viewerId === comment.authorId && active ? (
        <details className="codeCommentEditor">
          <summary>Редактировать</summary>
          <form action="/api/code/comments" method="post">
            <input type="hidden" name="action" value="edit" />
            <input type="hidden" name="section" value={section} />
            <input type="hidden" name="comment_id" value={comment.id} />
            <label>Текст комментария
              <textarea name="body" defaultValue={comment.body ?? ""} maxLength={2000} required />
            </label>
            <button type="submit">Сохранить</button>
          </form>
          <form action="/api/code/comments" method="post">
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="section" value={section} />
            <input type="hidden" name="comment_id" value={comment.id} />
            <button type="submit">Удалить свой текст</button>
          </form>
        </details>
      ) : null}
      {isAdmin ? (
        <div className="codeAdminActions">
          {!comment.parentId && active ? (
            <form action="/api/code/comments" method="post">
              <input type="hidden" name="action" value={comment.pinned ? "unpin" : "pin"} />
              <input type="hidden" name="section" value={section} />
              <input type="hidden" name="comment_id" value={comment.id} />
              <button type="submit">{comment.pinned ? "Открепить" : "Закрепить"}</button>
            </form>
          ) : null}
          {comment.hidden ? (
            <form action="/api/code/comments" method="post">
              <input type="hidden" name="action" value="unhide" />
              <input type="hidden" name="section" value={section} />
              <input type="hidden" name="comment_id" value={comment.id} />
              <button type="submit">Вернуть комментарий</button>
            </form>
          ) : active ? (
            <details>
              <summary>Скрыть</summary>
              <form action="/api/code/comments" method="post">
                <input type="hidden" name="action" value="hide" />
                <input type="hidden" name="section" value={section} />
                <input type="hidden" name="comment_id" value={comment.id} />
                <label>Причина скрытия
                  <input name="reason" maxLength={500} required />
                </label>
                <button type="submit">Скрыть с указанием причины</button>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
      {replies.length ? (
        <ol className="codeReplies">
          {replies.map((reply) => <CommentCard key={reply.id} comment={reply} replies={[]}
            section={section} viewerId={viewerId} isAdmin={isAdmin} />)}
        </ol>
      ) : null}
      {!comment.parentId && viewerId && active ? (
        <details className="codeReplyForm">
          <summary>Ответить</summary>
          <form action="/api/code/comments" method="post">
            <input type="hidden" name="action" value="create" />
            <input type="hidden" name="section" value={section} />
            <input type="hidden" name="parent_id" value={comment.id} />
            <label>Ваш ответ
              <textarea name="body" maxLength={2000} required />
            </label>
            <button type="submit">Опубликовать ответ</button>
          </form>
        </details>
      ) : null}
    </li>
  );
}

export function CodeDiscussion({ section, comments, sort, viewerId, isAdmin, initiallyOpen }: DiscussionProps) {
  const inSection = comments.filter((comment) => comment.section === section);
  const count = inSection.filter((comment) => !comment.deleted && !comment.hidden).length;
  const repliesByParent = new Map<string, CodeComment[]>();
  for (const comment of inSection) {
    if (!comment.parentId) continue;
    const replies = repliesByParent.get(comment.parentId) ?? [];
    replies.push(comment);
    repliesByParent.set(comment.parentId, replies);
  }
  return (
    <CodeDiscussionDetails initiallyOpen={initiallyOpen} commentIds={viewerId ? inSection.filter(c => !c.deleted && !c.hidden).map(c => c.id) : []}>
      <summary>Обсуждение · {count}</summary>
      <div className="codeDiscussionContent">
        <nav className="codeSort" aria-label="Сортировка комментариев">
          <Link href={`/code?sort=latest&section=${section}#${section}`} aria-current={sort === "latest" ? "page" : undefined}>Последние</Link>
          <Link href={`/code?sort=top&section=${section}#${section}`} aria-current={sort === "top" ? "page" : undefined}>Топ</Link>
        </nav>
        {inSection.length ? (
          <ol className="codeComments">
            {sortCodeCommentRoots(inSection, sort).map((comment) => (
              <CommentCard key={comment.id} comment={comment}
                replies={sortCodeCommentReplies(repliesByParent.get(comment.id) ?? [])}
                section={section} viewerId={viewerId} isAdmin={isAdmin} />
            ))}
          </ol>
        ) : <p className="muted">Комментариев пока нет.</p>}
        {viewerId ? (
          <form className="codeNewComment" action="/api/code/comments" method="post">
            <input type="hidden" name="action" value="create" />
            <input type="hidden" name="section" value={section} />
            <label>Ваш комментарий
              <textarea name="body" maxLength={2000} required />
            </label>
            <button className="button secondary" type="submit">Опубликовать</button>
          </form>
        ) : <p className="muted">Чтобы участвовать в обсуждении, войдите через главную страницу.</p>}
      </div>
    </CodeDiscussionDetails>
  );
}
