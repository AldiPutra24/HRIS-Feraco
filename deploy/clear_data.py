from apps.personnel.models import Employee, Department, Position, Personnel, EmployeeContract, EmployeeDocument
from apps.audit.models import AuditLog
from apps.leaves.models import LeaveRequest, LeaveBalance, LeaveNotification

print('=== before ===')
print('AuditLog  :', AuditLog.objects.count())
print('Employee  :', Employee.objects.count())
print('Personnel :', Personnel.objects.count())
print('Department:', Department.objects.count())

# 1. Audit log (no dependents)
AuditLog.objects.all().delete()

# 2. Employee + dependent records (Personnel base cascades children)
Employee.objects.all().delete()

# 3. Departments (only after personnel cleared; Position kept as config)
Department.objects.all().delete()

print('=== after ===')
print('AuditLog  :', AuditLog.objects.count())
print('Employee  :', Employee.objects.count())
print('Personnel :', Personnel.objects.count())
print('Department:', Department.objects.count())
