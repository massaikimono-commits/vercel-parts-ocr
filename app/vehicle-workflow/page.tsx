import { redirect } from "next/navigation";

type Props = { searchParams: Promise<{ mode?: string }> };

export default async function VehicleWorkflowEntry({ searchParams }: Props) {
  const { mode } = await searchParams;
  redirect(mode === "new" ? "/vehicle-workflow-v2?mode=new" : "/vehicle-workflow-v2");
}
