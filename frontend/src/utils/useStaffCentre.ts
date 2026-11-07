// Which centre is this staff screen about?
// Desk staff and managers: their own centre (the server knows it).
// Admin: the first centre in the list, changeable with a drop-down.

import { useEffect, useState } from "react";
import { api } from "../services/api";
import { socket } from "../services/socket";

export function useStaffCentre(centres?: { id: string; name: string }[]) {
  const [centreId, setCentreId] = useState("");
  const [centreName, setCentreName] = useState("");

  useEffect(() => {
    if (centres) {
      if (!centreId && centres.length > 0) setCentreId(centres[0].id);
      return;
    }
    if (centreId) return;
    api
      .get("/queue/my-centre")
      .then((r) => {
        setCentreId(r.data.centreId);
        setCentreName(r.data.centreName);
      })
      .catch(() => undefined);
  }, [centres, centreId]);

  useEffect(() => {
    if (centreId) socket.emit("join-centre", centreId);
  }, [centreId]);

  const name = centres ? (centres.find((c) => c.id === centreId)?.name ?? "") : centreName;
  return { centreId, setCentreId, centreName: name };
}
