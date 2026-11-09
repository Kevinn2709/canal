/**
 * useReactions.ts — Reacciones de una conversación, en vivo y descifradas.
 * Devuelve un mapa: id de mensaje -> reacciones (sin las quitadas).
 */

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { decryptReaction, type Reaction } from "@/lib/reactions";

export function useReactions(chatId: string, cryptoKey: CryptoKey): Map<string, Reaction[]> {
  const [byMessage, setByMessage] = useState<Map<string, Reaction[]>>(new Map());
  const cache = useRef(new Map<string, string>()); // id:ct -> emoji
  const seq = useRef(0);

  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "chats", chatId, "reactions"),
      (snap) => {
        const current = ++seq.current;
        void Promise.all(
          snap.docs.map(async (d): Promise<Reaction | null> => {
            const data = d.data();
            const msg = typeof data.msg === "string" ? data.msg : "";
            const uid = typeof data.uid === "string" ? data.uid : "";
            const ct = typeof data.ct === "string" ? data.ct : "";
            const iv = typeof data.iv === "string" ? data.iv : "";
            if (!msg || !uid || d.id !== `${msg}_${uid}`) return null;
            const cacheKey = `${d.id}:${ct}`;
            let emoji = cache.current.get(cacheKey);
            if (emoji === undefined) {
              try {
                emoji = await decryptReaction(cryptoKey, chatId, msg, uid, { iv, ct });
              } catch {
                emoji = "";
              }
              cache.current.set(cacheKey, emoji);
            }
            return emoji ? { msg, uid, emoji } : null;
          })
        ).then((list) => {
          if (current !== seq.current) return;
          const map = new Map<string, Reaction[]>();
          for (const r of list) {
            if (!r) continue;
            const arr = map.get(r.msg);
            if (arr) arr.push(r);
            else map.set(r.msg, [r]);
          }
          setByMessage(map);
        });
      },
      () => undefined
    );
  }, [chatId, cryptoKey]);

  return byMessage;
}
