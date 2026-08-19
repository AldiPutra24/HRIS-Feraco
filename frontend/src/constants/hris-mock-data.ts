import type { Employee, Event, Freelancer, LeaveRequest, Payroll, Reimbursement } from '@/types/hris';

export const summaryCards = [
  { label: 'Total Karyawan', value: '142', trend: '+3', trendUp: true },
  { label: 'Total Freelancer', value: '28', trend: '+5', trendUp: true },
  { label: 'Kontrak Akan Berakhir', value: '12', trend: '30 days', trendUp: false },
  { label: 'Pending Approval', value: '8', trend: 'action', trendUp: false },
  { label: 'Recruitment Active', value: '5', trend: '+2', trendUp: true },
  { label: 'Payroll Status', value: 'Processed', trend: 'Aug 2026', trendUp: true }
];

export const recentActivities = [
  { id: '1', name: 'Budi Wijaya', action: 'mengajukan cuti tahunan', time: '10 menit lalu' },
  { id: '2', name: 'Siti Rahma', action: 'mengajukan reimbursement transport', time: '1 jam lalu' },
  { id: '3', name: 'Andi Saputra', action: 'menyelesaikan task onboarding', time: '3 jam lalu' },
  { id: '4', name: 'Dewi Lestari', action: 'diterima sebagai kandidat', time: '5 jam lalu' },
  { id: '5', name: 'Rizky Hidayat', action: 'kontrak diperpanjang', time: 'Kemarin' }
];

export const upcomingContractExpiry: Employee[] = [
  {
    id: 'E-001',
    name: 'Budi Wijaya',
    email: 'budi@feraco.id',
    position: 'Staff Produksi',
    department: 'Produksi',
    joinDate: '2023-08-01',
    contractEndDate: '2026-08-30',
    employmentStatus: 'contract'
  },
  {
    id: 'E-002',
    name: 'Siti Rahma',
    email: 'siti@feraco.id',
    position: 'Accounting',
    department: 'Finance',
    joinDate: '2023-09-15',
    contractEndDate: '2026-09-05',
    employmentStatus: 'contract'
  },
  {
    id: 'E-003',
    name: 'Andi Saputra',
    email: 'andi@feraco.id',
    position: 'Operator',
    department: 'Produksi',
    joinDate: '2024-01-10',
    contractEndDate: '2026-09-20',
    employmentStatus: 'contract'
  }
];

export const pendingApprovals: Array<LeaveRequest | Reimbursement> = [
  {
    id: 'L-001',
    employeeId: 'E-001',
    type: 'cuti',
    startDate: '2026-08-20',
    endDate: '2026-08-24',
    status: 'pending',
    reason: 'Liburan keluarga'
  },
  {
    id: 'R-001',
    employeeId: 'E-002',
    category: 'Transport',
    amount: 450000,
    date: '2026-08-14',
    status: 'pending'
  },
  {
    id: 'L-002',
    employeeId: 'E-003',
    type: 'izin',
    startDate: '2026-08-18',
    endDate: '2026-08-18',
    status: 'pending',
    reason: 'Keperluan pribadi'
  },
  {
    id: 'R-002',
    employeeId: 'E-004',
    category: 'Meeting',
    amount: 250000,
    date: '2026-08-15',
    status: 'pending'
  }
];

export const freelanceEvents: Array<Event & { freelancers: number; progress: number }> = [
  {
    id: 'EV-001',
    title: 'Launching Produk Baru',
    date: '2026-08-28',
    location: 'Jakarta',
    client: 'PT Maju Bersama',
    status: 'approved',
    freelancers: 6,
    progress: 70
  },
  {
    id: 'EV-002',
    title: 'Workshop Pelatihan',
    date: '2026-09-10',
    location: 'Bandung',
    client: 'Yayasan Edukasi',
    status: 'pending',
    freelancers: 4,
    progress: 40
  },
  {
    id: 'EV-003',
    title: 'Corporate Gathering',
    date: '2026-09-25',
    location: 'Bogor',
    client: 'Feraco',
    status: 'approved',
    freelancers: 10,
    progress: 15
  }
];

export const freelancers: Freelancer[] = [
  { id: 'F-001', name: 'Rian Pratama', email: 'rian@freelance.id', skill: 'Fotografer', hourlyRate: 150000, status: 'assigned' },
  { id: 'F-002', name: 'Maya Sari', email: 'maya@freelance.id', skill: 'Videografer', hourlyRate: 200000, status: 'available' },
  { id: 'F-003', name: 'Doni Kurnia', email: 'doni@freelance.id', skill: 'Host / MC', status: 'available' }
];

export const payrolls: Payroll[] = [
  { id: 'P-001', period: 'Agustus 2026', totalEmployees: 142, totalFreelancers: 28, amount: 1250000000, status: 'processed', payoutDate: '2026-08-25' },
  { id: 'P-002', period: 'Juli 2026', totalEmployees: 140, totalFreelancers: 25, amount: 1180000000, status: 'paid', payoutDate: '2026-07-25' }
];
