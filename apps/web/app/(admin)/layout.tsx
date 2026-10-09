import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/admin/sidebar";
import { Header } from "@/components/admin/header";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={user.role === "ADMIN"} />
      <div className="relative flex flex-1 flex-col">
        <Header user={user} />
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
