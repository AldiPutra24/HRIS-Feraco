import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { upcomingContractExpiry } from '@/constants/hris-mock-data';

export function UpcomingContractExpiry() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Contract Expiry</CardTitle>
        <CardDescription>Kontrak yang akan berakhir dalam 30 hari ke depan.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Posisi</TableHead>
              <TableHead>Berakhir</TableHead>
              <TableHead className='text-right'>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {upcomingContractExpiry.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className='font-medium'>{employee.name}</TableCell>
                <TableCell>{employee.position}</TableCell>
                <TableCell>{employee.contractEndDate}</TableCell>
                <TableCell className='text-right'>
                  <Badge variant='outline'>Perpanjang</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
