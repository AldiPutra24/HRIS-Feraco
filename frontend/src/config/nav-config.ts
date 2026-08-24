import { NavGroup } from '@/types';

export const employeeNavGroups: NavGroup[] = [
  {
    label: 'Employee',
    items: [
      {
        title: 'Overview',
        url: '/dashboard/employee',
        icon: 'dashboard',
        isActive: false,
        items: []
      },
      {
        title: 'Profile',
        url: '/dashboard/employee/profile',
        icon: 'profile',
        isActive: false,
        items: []
      },
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
            title: 'Ajukan Cuti',
            url: '/dashboard/employee/leave/new',
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
        isActive: false,
        shortcut: ['d', 'd'],
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
        title: 'Reimbursement',
        url: '/dashboard/reimbursement',
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
        items: []
      },
      {
        title: 'Onboarding',
        url: '/dashboard/onboarding',
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
          }
        ]
      }
    ]
  }
];
