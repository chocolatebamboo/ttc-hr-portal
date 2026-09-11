import { redirect } from "next/navigation";

/** CB, Sept 2026: "instead of notes, I want it to be messages... so its no longer notes its
 *  'My Messages.'" /messages is the new unified inbox (see
 *  src/app/(portal)/messages/MessagesInboxView.tsx) — this route stays only so an old bookmark
 *  or saved link still lands somewhere real. */
export default function NotesPage() {
  redirect("/messages");
}
