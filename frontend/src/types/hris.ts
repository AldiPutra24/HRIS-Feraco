export type AuthRole = 'admin' | 'hr_staff' | 'hr_lead' | 'employee' | 'management';

export type EmploymentStatus = 'permanent' | 'contract' | 'probation';
export type FreelancerStatus = 'available' | 'assigned' | 'inactive';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type User = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  position: string;
  department: string;
  joinDate: string;
  contractEndDate?: string;
  employmentStatus: EmploymentStatus;
};

export type Freelancer = {
  id: string;
  name: string;
  email: string;
  skill: string;
  hourlyRate?: number;
  status: FreelancerStatus;
};

export type Event = {
  id: string;
  title: string;
  date: string;
  location: string;
  client?: string;
  status: RequestStatus;
};

export type Task = {
  id: string;
  title: string;
  assignee: string;
  status: 'todo' | 'in_progress' | 'done';
  dueDate: string;
  progress: number;
};

export type LeaveRequest = {
  id: string;
  employeeId: string;
  type: 'cuti' | 'izin' | 'sakit';
  startDate: string;
  endDate: string;
  status: RequestStatus;
  reason: string;
};

export type Reimbursement = {
  id: string;
  employeeId: string;
  category: string;
  amount: number;
  date: string;
  status: RequestStatus;
};

export type Candidate = {
  id: string;
  name: string;
  position: string;
  stage: 'applied' | 'interview' | 'offer' | 'hired';
  appliedDate: string;
};

export type Payroll = {
  id: string;
  period: string;
  totalEmployees: number;
  totalFreelancers: number;
  amount: number;
  status: 'draft' | 'processed' | 'paid';
  payoutDate?: string;
};
