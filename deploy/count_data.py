from apps.personnel.models import Employee, Department, Position, Personnel, EmployeeContract, EmployeeDocument
from apps.audit.models import AuditLog
from apps.leaves.models import LeaveRequest, LeaveBalance, LeaveNotification

print('Department       :', Department.objects.count())
print('Position         :', Position.objects.count())
print('Personnel (base) :', Personnel.objects.count())
print('Employee         :', Employee.objects.count())
print('EmployeeContract :', EmployeeContract.objects.count())
print('EmployeeDocument :', EmployeeDocument.objects.count())
print('LeaveRequest     :', LeaveRequest.objects.count())
print('LeaveBalance     :', LeaveBalance.objects.count())
print('LeaveNotification:', LeaveNotification.objects.count())
print('AuditLog         :', AuditLog.objects.count())
