/**
 * useMyProfile.ts — Tu propio perfil, en vivo.
 *
 * También se asegura de que tu llave pública esté publicada en users/{uid}
 * (por si la primera vez se cortó la conexión a medio camino).
 */

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { decryptProfile } from "@/lib/members";
import { publishIdentity, type Session } from "@/lib/session";

export interface MyProfile {
  loading: boolean;
  valid: boolean;
  name: string;
  photo: number;
}

export function useMyProfile(session: Session): MyProfile {
  const [state, setState] = useState<MyProfile>({ loading: true, valid: false, name: "", photo: 0 });

  useEffect(() => {
    const { db } = getFirebase();
    let published = false;
    let seq = 0;
    return onSnapshot(
      doc(db, "users", session.uid),
      (snap) => {
        const data = snap.data() ?? {};
        if ((data.pub !== session.identity.pub || data.founder !== session.founder) && !published) {
          published = true;
          void publishIdentity(db, session).catch(() => {
            published = false;
          });
        }
        const current = ++seq;
        const sealed =
          typeof data.profIv === "string" && typeof data.profCt === "string" ? { iv: data.profIv, ct: data.profCt } : null;
        if (!session.ws || !sealed) {
          setState({ loading: false, valid: false, name: "", photo: 0 });
          return;
        }
        void decryptProfile(session.ws, session.uid, session.identity.fp, sealed).then((p) => {
          if (current !== seq) return;
          setState(p ? { loading: false, valid: true, name: p.name, photo: p.photo } : { loading: false, valid: false, name: "", photo: 0 });
        });
      },
      () => setState({ loading: false, valid: false, name: "", photo: 0 })
    );
  }, [session]);

  return state;
}
