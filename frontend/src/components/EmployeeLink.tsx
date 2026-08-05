import { Link } from "react-router-dom";

import { usePermissions } from "@/hooks/usePermissions";

// Wherever an employee's name is shown -- Org Chart, Employee Directory,
// task assignee, project/goal owner, Review Queue -- this makes it open
// Employee 360 for leaders who hold employee.view_360, and falls back to
// plain text for everyone else (a dead link to a page they'd immediately
// bounce out of via RequirePermission is worse than no link). Whether the
// target employee is actually visible to THIS caller is still entirely
// RLS's call once they land on the page -- this component only decides
// whether to render a link at all.
export function EmployeeLink({ employeeId, name, className = "" }: { employeeId: string; name: string; className?: string }) {
  const { has } = usePermissions();

  if (!has("employee", "view_360")) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link to={`/employees/${employeeId}`} className={`text-edge-teal hover:underline ${className}`}>
      {name}
    </Link>
  );
}
