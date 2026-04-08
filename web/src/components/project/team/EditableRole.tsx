import { Shield, Edit2 } from "lucide-react";

interface EditableRoleProps {
  label: string;
  canEdit: boolean;
  onOpenManage: () => void;
}

export function EditableRole({ label, canEdit, onOpenManage }: EditableRoleProps) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200 truncate max-w-full">
          {label}
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={onOpenManage}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              title="Manage role and permissions"
            >
              <Shield className="w-3 h-3" />
              <Edit2 className="w-3 h-3" />
              <span className="text-[9px] font-semibold">Manage</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}

