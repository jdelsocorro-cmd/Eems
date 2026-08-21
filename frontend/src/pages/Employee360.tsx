import { useParams } from "react-router-dom";

import { EmployeeProfileBody } from "@/components/employee360/EmployeeProfileBody";

// Thin route wrapper -- the actual tabs/data logic lives in
// EmployeeProfileBody, shared with the Org Chart's slide-in
// EmployeeSidePanel so there's one implementation, not a fork.
export default function Employee360() {
  const { employeeId = "" } = useParams<{ employeeId: string }>();

  return (
    <div className="flex flex-col gap-6">
      <EmployeeProfileBody employeeId={employeeId} />
    </div>
  );
}
