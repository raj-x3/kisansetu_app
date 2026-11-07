// Staff work on their own centre only. An admin may work on any centre.
import { prisma } from "./prismaClient";

export async function canAccessCentre(userId: string, role: string, centreId: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  const op = await prisma.operator.findUnique({ where: { userId } });
  return op?.centreId === centreId;
}

// Which centre does this staff request mean? Staff: their own. Admin: ?centreId=.
export async function resolveStaffCentre(
  userId: string,
  role: string,
  requested: unknown
): Promise<{ centreId: string } | { status: number; error: string }> {
  if (role === "ADMIN") {
    const id = String(requested ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, error: "Please choose a centre." };
    const c = await prisma.procurementCentre.findUnique({ where: { id } });
    return c ? { centreId: c.id } : { status: 404, error: "Centre not found." };
  }
  const op = await prisma.operator.findUnique({ where: { userId } });
  return op ? { centreId: op.centreId } : { status: 404, error: "Staff profile not found." };
}
