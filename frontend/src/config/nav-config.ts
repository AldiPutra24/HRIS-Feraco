import { NavGroup } from '@/types';

// Employee dashboard: Overview → People → Operations → Finance & Reporting → Knowledge.
export const employeeNavGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Overview',
        url: '/dashboard/employee',
        icon: 'dashboard',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'People',
    items: [
      {
        title: 'Profile',
        url: '/dashboard/employee/profile',
        icon: 'profile',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Izin & Cuti',
        url: '/dashboard/employee/leave',
        icon: 'leave',
        isActive: false,
        items: [
          {
            title: 'Pengajuan Saya',
            url: '/dashboard/employee/leave',
            isActive: false,
            items: []
          },
          {
            title: 'Ajukan Izin & Cuti',
            url: '/dashboard/employee/leave/new',
            isActive: false,
            items: []
          }
        ]
      },
      {
        title: 'Reimbursement',
        url: '/dashboard/employee/reimbursement',
        icon: 'receipt',
        isActive: false,
        items: [
          {
            title: 'Pengajuan Saya',
            url: '/dashboard/employee/reimbursement',
            isActive: false,
            items: []
          },
          {
            title: 'Ajukan Reimbursement',
            url: '/dashboard/employee/reimbursement/new',
            isActive: false,
            items: []
          }
        ]
      },
      {
        title: 'Kontrak',
        url: '/dashboard/employee/contract',
        icon: 'page',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Finance & Reporting',
    items: [
      {
        title: 'Slip Gaji',
        url: '/dashboard/employee/payslip',
        icon: 'wallet',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Knowledge',
    items: [
      {
        title: 'Knowledge / KMS',
        url: '/kms',
        icon: 'books',
        isActive: false,
        items: []
      }
    ]
  }
];

// Management & General Manager role: monitoring-only nav (team scope enforced
// by backend — direct reports for Management, full hierarchy for GM).
// Group labels are kept consistent with the HR/Admin sidebar; leave approval
// and payroll routes are shared so the same groups work for both roles.
// Note: no Freelance / Talent Pool — MANAGEMENT has no Freelance access;
// the Payroll link shows only the user's own payslips for Management.
export const managementNavGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/management/overview',
        icon: 'dashboard',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'People',
    items: [
      {
        title: 'Karyawan',
        url: '/dashboard/karyawan',
        icon: 'employee',
        isActive: false,
        items: []
      },
      {
        title: 'Freelance / Talent Pool',
        url: '/dashboard/freelance',
        icon: 'freelancer',
        isActive: false,
        // GM only: read-only Talent Pool access (enforced by backend);
        // MANAGEMENT has no Freelance access at all.
        access: { roles: ['general_manager'] },
        items: []
      }
    ]
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Izin & Cuti',
        url: '/dashboard/management/leave',
        icon: 'leave',
        isActive: false,
        items: []
      },
      {
        title: 'Reimbursement',
        url: '/dashboard/management/reimbursement',
        icon: 'receipt',
        isActive: false,
        items: [
          {
            title: 'Pengajuan Saya',
            url: '/dashboard/management/reimbursement',
            isActive: false,
            items: []
          },
          {
            title: 'Ajukan Reimbursement',
            url: '/dashboard/management/reimbursement/new',
            isActive: false,
            items: []
          }
        ]
      }
    ]
  },
  {
    label: 'Finance & Reporting',
    items: [
      {
        title: 'Payroll',
        url: '/dashboard/payroll',
        icon: 'wallet',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Knowledge',
    items: [
      {
        title: 'Knowledge / KMS',
        url: '/kms',
        icon: 'books',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Personal',
    items: [
      {
        title: 'Profile',
        url: '/dashboard/settings/account',
        icon: 'account',
        isActive: false,
        items: []
      }
    ]
  }
];

export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['d', 'd'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'People',
    items: [
      {
        title: 'Karyawan',
        url: '/dashboard/karyawan',
        icon: 'employee',
        shortcut: ['k', 'k'],
        isActive: false,
        items: []
      },
      {
        title: 'Freelance / Talent Pool',
        url: '/dashboard/freelance',
        icon: 'freelancer',
        shortcut: ['f', 'f'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Knowledge',
    items: [
      {
        title: 'Knowledge / KMS',
        url: '/kms',
        icon: 'books',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Event',
        url: '/dashboard/event',
        icon: 'event',
        isActive: false,
        items: []
      },
      {
        title: 'Task & Progress',
        url: '/dashboard/task',
        icon: 'task',
        isActive: false,
        items: []
      },
      {
        title: 'Izin & Cuti',
        url: '/dashboard/leave',
        icon: 'leave',
        isActive: false,
        items: []
      },
      {
        title: 'Manajemen',
        url: '/dashboard/management/overview',
        icon: 'teams',
        isActive: false,
        access: { roles: ['management', 'general_manager'] },
        items: [
          {
            title: 'Overview',
            url: '/dashboard/management/overview',
            isActive: false,
            items: []
          },
          {
            title: 'Persetujuan Izin & Cuti',
            url: '/dashboard/management/leave',
            isActive: false,
            items: []
          }
        ]
      },
      {
        title: 'Reimbursement',
        url: '/dashboard/reimbursements',
        icon: 'receipt',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Talent',
    items: [
      {
        title: 'Recruitment',
        url: '/dashboard/recruitment',
        icon: 'userPlus',
        isActive: false,
        items: [
          {
            title: 'Inhouse',
            url: '/dashboard/recruitment/jobs?type=INHOUSE',
            isActive: false,
            items: []
          },
          {
            title: 'Freelance',
            url: '/dashboard/recruitment/jobs?type=FREELANCE',
            isActive: false,
            items: []
          }
        ]
      },
      {
        title: 'Candidate',
        url: '/dashboard/recruitment/candidates',
        icon: 'teams',
        isActive: false,
        items: [
          {
            title: 'Inhouse',
            url: '/dashboard/recruitment/candidates',
            isActive: false,
            items: []
          },
          {
            title: 'Freelance / Talent Pool',
            url: '/dashboard/recruitment/candidates/freelance',
            isActive: false,
            items: []
          }
        ]
      },
      {
        title: 'Onboarding',
        url: '/dashboard/recruitment/onboarding',
        icon: 'onboarding',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Finance & Reporting',
    items: [
      {
        title: 'Payroll',
        url: '/dashboard/payroll',
        icon: 'wallet',
        isActive: false,
        items: []
      },
      {
        title: 'Reports',
        url: '/dashboard/reports',
        icon: 'report',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'System',
    items: [
      {
        title: 'Settings',
        url: '/dashboard/settings',
        icon: 'settings',
        isActive: false,
        items: [
          {
            title: 'Account',
            url: '/dashboard/settings/account',
            icon: 'account',
            isActive: false,
            items: []
          },
          {
            title: 'Departments',
            url: '/dashboard/settings/departments',
            isActive: false,
            items: []
          },
          {
            title: 'Positions',
            url: '/dashboard/settings/positions',
            isActive: false,
            items: []
          },
          {
            title: 'Users',
            url: '/dashboard/settings/users',
            isActive: false,
            items: []
          },
          {
            title: 'Roles',
            url: '/dashboard/settings/roles',
            isActive: false,
            items: []
          },
          {
            title: 'Audit Log',
            url: '/dashboard/settings/audit-log',
            icon: 'clock',
            isActive: false,
            items: []
          },
          {
            title: 'Notification & Email',
            url: '/dashboard/settings/notification',
            icon: 'notification',
            isActive: false,
            items: []
          },
          {
            title: 'Riwayat Delivery',
            url: '/dashboard/settings/delivery-logs',
            icon: 'send',
            isActive: false,
            items: []
          }
        ]
      }
    ]
  }
];
