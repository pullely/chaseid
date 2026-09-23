import { redirect } from "next/navigation";
import { orgHomePath } from "@/lib/org-home";

export default function OrgRoot({ params }: { params: { orgSlug: string } }) {
  // The org root is the org's home: the status board, under every profile.
  redirect(orgHomePath(params.orgSlug));
}
