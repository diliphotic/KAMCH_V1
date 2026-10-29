import React from 'react';
import {
  Cpu,
  Database,
  Terminal,
  ShieldAlert,
  FolderTree,
  Laptop,
  CheckCircle2,
  FileCode,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Notification } from '../components/ui/Notification';

export const ArchitectureView: React.FC = () => {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Windows & Server Architecture"
        kicker="Local Deployment Readiness"
        description="Specifications for exporting, configuring, and executing KAMCH ERP on a Windows laptop with a Node.js backend and local MySQL database."
        breadcrumbs={[
          { label: 'KAMCH ERP', href: '#' },
          { label: 'Foundation', href: '#' },
          { label: 'Architecture', current: true },
        ]}
      />

      {/* Security & Constraint Alert */}
      <Notification
        type="institutional"
        title="Security & Independence Standards"
        message={
          <span>
            This codebase contains <strong>zero hardcoded database credentials, authentication secrets, or API keys</strong>. The system has <strong>zero dependency on Firebase or Firestore</strong>. All future persistence connects through the Node.js server to an on-premise or cloud MySQL instance.
          </span>
        }
      />

      {/* Windows Local Execution Guide */}
      <Card accentTop>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Windows Laptop Execution Workflow</CardTitle>
              <CardDescription>
                Step-by-step instructions for running the exported project in Windows PowerShell or CMD.
              </CardDescription>
            </div>
          </div>
          <Badge variant="institutional" size="sm">Windows 10 / 11</Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-2 font-semibold text-xs text-stone-900 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#4B2E2E] text-white flex items-center justify-center text-[11px]">
                  1
                </span>
                <span>Prerequisites Check</span>
              </div>
              <p className="text-xs text-stone-600 pl-7 leading-relaxed">
                Ensure Node.js (version 18 or 20 LTS) and MySQL Server (version 8.0+, MariaDB, or XAMPP) are installed on your Windows system.
              </p>
            </div>

            <div className="p-4 rounded-md bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-2 font-semibold text-xs text-stone-900 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#4B2E2E] text-white flex items-center justify-center text-[11px]">
                  2
                </span>
                <span>Extract & Install Dependencies</span>
              </div>
              <div className="pl-7 space-y-2">
                <p className="text-xs text-stone-600">
                  Open Windows Terminal or PowerShell in the extracted folder and run:
                </p>
                <pre className="p-2.5 rounded bg-stone-900 text-stone-100 font-mono text-xs overflow-x-auto">
                  npm install
                </pre>
              </div>
            </div>

            <div className="p-4 rounded-md bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-2 font-semibold text-xs text-stone-900 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#4B2E2E] text-white flex items-center justify-center text-[11px]">
                  3
                </span>
                <span>Configure Local Environment</span>
              </div>
              <div className="pl-7 space-y-2">
                <p className="text-xs text-stone-600">
                  Copy <code className="text-[#4B2E2E] font-semibold">.env.example</code> to <code className="text-[#4B2E2E] font-semibold">.env</code> and fill in your local MySQL credentials:
                </p>
                <pre className="p-2.5 rounded bg-stone-900 text-stone-100 font-mono text-xs overflow-x-auto">
                  copy .env.example .env
                </pre>
              </div>
            </div>

            <div className="p-4 rounded-md bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-2 font-semibold text-xs text-stone-900 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#4B2E2E] text-white flex items-center justify-center text-[11px]">
                  4
                </span>
                <span>Launch Development Server</span>
              </div>
              <div className="pl-7 space-y-2">
                <p className="text-xs text-stone-600">
                  Start the full-stack Node.js and Vite application server:
                </p>
                <pre className="p-2.5 rounded bg-stone-900 text-stone-100 font-mono text-xs overflow-x-auto">
                  npm run dev
                </pre>
                <p className="text-xs text-stone-500">
                  The application will be live at <span className="font-mono text-stone-700">http://localhost:3000</span>.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Project Structure & Separation of Concerns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-[#4B2E2E]" />
              <CardTitle>Separation of Concerns</CardTitle>
            </div>
            <Badge variant="neutral" size="sm">Directory Layout</Badge>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs text-stone-700 leading-relaxed">
            <div className="p-3 bg-stone-50 rounded border border-stone-200 space-y-1.5 overflow-x-auto">
              <div><strong className="text-[#4B2E2E]">/server.ts</strong> — Node.js Express server entry point</div>
              <div><strong className="text-[#4B2E2E]">/src/components/ui/</strong> — Reusable institutional UI components</div>
              <div><strong className="text-[#4B2E2E]">/src/components/layout/</strong> — AppLayout, Sidebar, TopNavbar</div>
              <div><strong className="text-[#4B2E2E]">/src/views/</strong> — Primary view containers</div>
              <div><strong className="text-[#4B2E2E]">/src/config/</strong> — Navigation and module registries</div>
              <div><strong className="text-[#4B2E2E]">/src/types/</strong> — Strict TypeScript interfaces</div>
              <div><strong className="text-[#4B2E2E]">/.env.example</strong> — Server & MySQL config template</div>
            </div>
          </CardContent>
          <CardFooter>
            <span className="text-xs text-stone-500">
              Clean separation: Frontend code never accesses DB directly
            </span>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#D4AF37]" />
              <CardTitle>MySQL Connection Pool & Verification</CardTitle>
            </div>
            <Badge variant="gold" size="sm">MySQL2 Active</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-stone-600 leading-relaxed">
            <p>
              The reusable connection pool is implemented via <code className="font-mono text-stone-800">mysql2/promise</code> in <code className="font-mono text-stone-800">/server/db.ts</code>, reading credentials safely from <code className="font-mono text-stone-800">.env</code>.
            </p>
            <div className="space-y-1.5 p-3 rounded bg-[#FAF9F5] border border-stone-200 text-stone-700">
              <div className="flex items-center gap-1.5 font-semibold text-stone-900">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Verification Endpoint Ready</span>
              </div>
              <p className="text-[11px] text-stone-600">
                <code className="font-mono text-stone-800">GET /api/health/database</code> executes a benign verification query (<code className="font-mono text-stone-800">SELECT 1</code>) to confirm XAMPP / local MySQL connectivity without exposing credentials.
              </p>
            </div>
            <div className="space-y-1.5 p-3 rounded bg-[#FAF9F5] border border-stone-200 text-stone-700">
              <div className="flex items-center gap-1.5 font-semibold text-stone-900">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Non-Blocking Resilient Startup</span>
              </div>
              <p className="text-[11px] text-stone-600">
                If the database service is starting or paused, the Express server continues running gracefully in standalone mode.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <span className="text-xs text-stone-500">
              Test locally: curl http://localhost:3000/api/health/database
            </span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
