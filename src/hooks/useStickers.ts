/** useStickers.ts — Biblioteca de stickers (compartida por todos) en vivo, descifrada. */

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { decryptSticker, type Sticker } from "@/lib/stickers";
import type { FileInfo } from "@/lib/chats";

export function useStickers(ws: CryptoKey): Sticker[] | null {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const cache = useRef(new Map<string, FileInfo | null>());
  const seq = useRef(0);

  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "library"),
      (snap) => {
        const current = ++seq.current;
        void Promise.all(
          snap.docs.map(async (d): Promise<Sticker | null> => {
            const data = d.data({ serverTimestamps: "estimate" });
            if (data.hidden === true) return null;
            const ct = typeof data.ct === "string" ? data.ct : "";
            const iv = typeof data.iv === "string" ? data.iv : "";
            let file = cache.current.get(d.id);
            if (file === undefined) {
              file = await decryptSticker(ws, d.id, { iv, ct });
              cache.current.set(d.id, file);
            }
            if (!file) return null;
            const ts = data.createdAt as Timestamp | null | undefined;
            return {
              id: d.id,
              uid: typeof data.uid === "string" ? data.uid : "",
              file,
              createdAt: ts ? ts.toDate() : null,
            };
          })
        ).then((list) => {
          if (current !== seq.current) return;
          const visible = list.filter((s): s is Sticker => s !== null);
          visible.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
          setStickers(visible);
        });
      },
      () => setStickers([])
    );
  }, [ws]);

  return stickers;
}
