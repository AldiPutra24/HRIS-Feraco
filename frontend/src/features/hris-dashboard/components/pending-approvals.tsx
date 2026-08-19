import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { pendingApprovals } from '@/constants/hris-mock-data';

export function PendingApprovals() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Approvals</CardTitle>
        <CardDescription>Permintaan yang menunggu persetujuan.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead className='text-right'>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingApprovals.map((item) => {
              const isLeave = 'type' in item;
              return (
                <TableRow key={item.id}>
                  <TableCell className='font-medium'>{item.id}</TableCell>
                  <TableCell>{isLeave ? 'Izin / Cuti' : 'Reimbursement'}</TableCell>
                  <TableCell>
                    {isLeave
                      ? item.reason
                      : `Rp ${item.amount.toLocaleString('id-ID')}`}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Badge variant='outline'>Pending</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
