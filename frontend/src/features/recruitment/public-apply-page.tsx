'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApplyForm } from '@/features/recruitment/apply-form';

/** Public Open Application / Talent Pool form (also lists open vacancies). */
export function PublicApplyPage() {
  return (
    <main className='min-h-screen bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] py-10'>
      <div className='mx-auto w-full max-w-3xl px-4'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src='/frc-recruitment.webp'
          alt='FeraCo Recruitment'
          className='mb-6 h-40 w-full rounded-2xl object-cover md:h-56'
        />
        <Card>
          <CardHeader>
            <CardTitle className='text-2xl font-bold tracking-tight'>Feraco Recruitment &amp; Talent Pool Form</CardTitle>
            <CardDescription className='space-y-2'>
              <span className='block'>
                This form is part of the Recruitment &amp; Selection process at PT Fery Agung Corindotama. We are
                committed to maintaining the confidentiality of all personal data you provide.
              </span>
              <span className='block'>
                Please make sure all information is accurate, truthful, and complete. Prepare an updated CV (PDF / DOC /
                DOCX, max. 5 MB) and a portfolio link, if applicable.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
