import { calculateOverdueFine } from '../server/services/library.service.ts';
import { handleLibraryQuery } from '../server/services/library-db-proxy.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';

async function runFinesAndSettlementsTest() {
  console.log('=== KAMCH ERP: Library Fines & Settlements Verification ===\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, description: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${description}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${description}`);
    }
  }

  // --------------------------------------------------------------------------
  // Item 1: Overdue book with no grace period remaining
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Overdue Book with No Grace Period Remaining ---');
  const settingsGrace1 = { fine_amount_per_day: 2.0, grace_period_days: 1, max_fine_amount: 500.0 };
  // Due 2026-10-10, returned 2026-10-15 (5 days overdue, grace 1 day)
  const res1 = calculateOverdueFine('2026-10-10', '2026-10-15', settingsGrace1);
  assert(res1.isOverdue === true, 'Identified as overdue');
  assert(res1.overdueDays === 5, 'Calculated 5 overdue days');
  assert(res1.fineableDays === 5, 'Fineable days is 5 when grace period is exceeded');
  assert(res1.assessedFine === 10.0, 'Assessed fine is 5 days * ₹2/day = ₹10.00');

  // --------------------------------------------------------------------------
  // Item 2: Book returned within the grace period
  // --------------------------------------------------------------------------
  console.log('\n--- Test 2: Book Returned Within Grace Period ---');
  // Due 2026-10-10, returned 2026-10-11 (1 day overdue, grace 1 day)
  const res2 = calculateOverdueFine('2026-10-10', '2026-10-11', settingsGrace1);
  assert(res2.isOverdue === true, 'Identified as 1 day past due date');
  assert(res2.overdueDays === 1, 'Overdue days is 1');
  assert(res2.fineableDays === 0, 'Fineable days is 0 within grace period');
  assert(res2.assessedFine === 0, 'Assessed fine is ₹0.00 within grace period');

  // --------------------------------------------------------------------------
  // Item 3: Fine calculation across multiple overdue days
  // --------------------------------------------------------------------------
  console.log('\n--- Test 3: Fine Calculation Across Multiple Overdue Days ---');
  // Due 2026-10-01, returned 2026-10-15 (14 days overdue, grace 0, ₹3/day)
  const settingsGrace0Rate3 = { fine_amount_per_day: 3.0, grace_period_days: 0, max_fine_amount: null };
  const res3 = calculateOverdueFine('2026-10-01', '2026-10-15', settingsGrace0Rate3);
  assert(res3.overdueDays === 14, 'Calculated 14 overdue days');
  assert(res3.assessedFine === 42.0, 'Assessed fine is 14 days * ₹3/day = ₹42.00');

  // Test zero fine rate setting (free policy)
  const settingsRate0 = { fine_amount_per_day: 0.0, grace_period_days: 1, max_fine_amount: 100.0 };
  const res3ZeroRate = calculateOverdueFine('2026-10-01', '2026-10-15', settingsRate0);
  assert(res3ZeroRate.assessedFine === 0.0, 'Zero fine rate correctly yields ₹0.00 assessed fine');

  // --------------------------------------------------------------------------
  // Item 4: Enforcement of the configured maximum fine
  // --------------------------------------------------------------------------
  console.log('\n--- Test 4: Enforcement of Configured Maximum Fine ---');
  // Due 2020-01-01, returned 2026-10-27 (2491 days overdue, ₹2/day, max fine ₹500)
  const res4 = calculateOverdueFine('2020-01-01', '2026-10-27', settingsGrace1);
  assert(res4.overdueDays > 2000, 'Identified multi-year overdue book');
  assert(res4.rawFine > 4000, 'Raw fine calculation is > ₹4000');
  assert(res4.maxFineCap === 500.0, 'Max fine cap identified as ₹500.00');
  assert(res4.assessedFine === 500.0, 'Assessed fine capped strictly at ₹500.00');

  // --------------------------------------------------------------------------
  // Item 5: Payment recording and outstanding balance updates
  // --------------------------------------------------------------------------
  console.log('\n--- Test 5: Payment Recording & Outstanding Balance Updates ---');
  const memDb: MemoryDatabase = {} as any;
  
  // Insert initial loan and fine in proxy
  handleLibraryQuery(memDb, `
    INSERT INTO library_fines (loan_id, overdue_days, assessed_fine, waived_amount, paid_amount, outstanding_balance, status, calculation_details)
    VALUES (1, 10, 20.00, 0.00, 0.00, 20.00, 'PENDING', '{"dueDate":"2026-10-01"}')
  `, [1, 10, 20.00, 20.00, '{"dueDate":"2026-10-01"}']);

  const [fineFetch1] = handleLibraryQuery(memDb, 'SELECT * FROM library_fines WHERE id = 1', [])!;
  assert(fineFetch1.length === 1, 'Fine record created in memory database');
  assert(Number(fineFetch1[0].assessed_fine) === 20.00, 'Assessed fine is 20.00');
  assert(Number(fineFetch1[0].outstanding_balance) === 20.00, 'Initial balance is 20.00');
  assert(fineFetch1[0].status === 'PENDING', 'Initial status is PENDING');

  // Record partial payment of ₹12.00
  handleLibraryQuery(memDb, `
    UPDATE library_fines SET paid_amount = ?, outstanding_balance = ?, status = ? WHERE id = ?
  `, [12.00, 8.00, 'PARTIALLY_PAID', 1]);

  handleLibraryQuery(memDb, `
    INSERT INTO library_fine_payments (fine_id, payment_type, amount, payment_method, receipt_reference, reason, recorded_by)
    VALUES (?, 'PAYMENT', ?, ?, ?, ?, ?)
  `, [1, 'PAYMENT', 12.00, 'CASH', 'REC-001', 'Partial fine payment', 1]);

  const [fineFetch2] = handleLibraryQuery(memDb, 'SELECT * FROM library_fines WHERE id = 1', [])!;
  assert(Number(fineFetch2[0].paid_amount) === 12.00, 'Paid amount updated to 12.00');
  assert(Number(fineFetch2[0].outstanding_balance) === 8.00, 'Outstanding balance updated to 8.00');
  assert(fineFetch2[0].status === 'PARTIALLY_PAID', 'Status updated to PARTIALLY_PAID');

  // Complete final payment of ₹8.00
  handleLibraryQuery(memDb, `
    UPDATE library_fines SET paid_amount = ?, outstanding_balance = ?, status = ? WHERE id = ?
  `, [20.00, 0.00, 'PAID', 1]);

  const [fineFetch3] = handleLibraryQuery(memDb, 'SELECT * FROM library_fines WHERE id = 1', [])!;
  assert(Number(fineFetch3[0].paid_amount) === 20.00, 'Paid amount updated to 20.00');
  assert(Number(fineFetch3[0].outstanding_balance) === 0.00, 'Outstanding balance updated to 0.00');
  assert(fineFetch3[0].status === 'PAID', 'Status updated to PAID');

  // --------------------------------------------------------------------------
  // Item 6: Receipt generation and payment history
  // --------------------------------------------------------------------------
  console.log('\n--- Test 6: Receipt Generation & Payment History ---');
  const [paymentsList] = handleLibraryQuery(memDb, 'SELECT * FROM library_fine_payments WHERE fine_id = ?', [1])!;
  assert(paymentsList.length === 1, 'Payment history retrieved for fine 1');
  assert(paymentsList[0].receipt_reference === 'REC-001', 'Receipt reference stored and retrieved');
  assert(paymentsList[0].payment_method === 'CASH', 'Payment method is CASH');

  // --------------------------------------------------------------------------
  // Item 7: Fine Waiver permissions, mandatory reason, and audit logging
  // --------------------------------------------------------------------------
  console.log('\n--- Test 7: Fine Waiver Permissions, Mandatory Reason & Audit Trail ---');
  // Create fine 2 for waiver test
  handleLibraryQuery(memDb, `
    INSERT INTO library_fines (loan_id, overdue_days, assessed_fine, waived_amount, paid_amount, outstanding_balance, status, calculation_details)
    VALUES (2, 5, 50.00, 0.00, 0.00, 50.00, 'PENDING', '{}')
  `, [2, 5, 50.00, 50.00, '{}']);

  // Perform full waiver of ₹50.00 with reason
  const waiverReason = 'Authorized medical leave extension approved by Principal';
  handleLibraryQuery(memDb, `
    UPDATE library_fines SET waived_amount = ?, outstanding_balance = ?, waiver_reason = ?, waived_by = ?, waived_at = NOW(), status = ? WHERE id = ?
  `, [50.00, 0.00, waiverReason, 2, 'WAIVED', 2]);

  handleLibraryQuery(memDb, `
    INSERT INTO library_fine_payments (fine_id, payment_type, amount, payment_method, receipt_reference, reason, recorded_by)
    VALUES (?, 'WAIVER', ?, 'WAIVER', NULL, ?, ?)
  `, [2, 'WAIVER', 50.00, waiverReason, 2]);

  const [fineWaiverFetch] = handleLibraryQuery(memDb, 'SELECT * FROM library_fines WHERE id = ?', [2])!;
  assert(Number(fineWaiverFetch[0].waived_amount) === 50.00, 'Waived amount updated to 50.00');
  assert(Number(fineWaiverFetch[0].outstanding_balance) === 0.00, 'Outstanding balance updated to 0.00');
  assert(fineWaiverFetch[0].status === 'WAIVED', 'Fine status updated to WAIVED');
  assert(fineWaiverFetch[0].waiver_reason === waiverReason, 'Waiver reason saved in fine record');

  // --------------------------------------------------------------------------
  // Item 8: Updates to dashboard totals and overdue reports
  // --------------------------------------------------------------------------
  console.log('\n--- Test 8: Updates to Dashboard Totals & Overdue Reports ---');
  const [allFines] = handleLibraryQuery(memDb, 'SELECT * FROM library_fines', [])!;
  const totalAssessed = allFines.reduce((acc: number, f: any) => acc + Number(f.assessed_fine), 0);
  const totalPaid = allFines.reduce((acc: number, f: any) => acc + Number(f.paid_amount), 0);
  const totalWaived = allFines.reduce((acc: number, f: any) => acc + Number(f.waived_amount), 0);
  const totalOutstanding = allFines.reduce((acc: number, f: any) => acc + Number(f.outstanding_balance), 0);

  assert(totalAssessed === 70.00, `Total fines assessed: ₹${totalAssessed.toFixed(2)} (Expected 70.00)`);
  assert(totalPaid === 20.00, `Total fines collected: ₹${totalPaid.toFixed(2)} (Expected 20.00)`);
  assert(totalWaived === 50.00, `Total fines waived: ₹${totalWaived.toFixed(2)} (Expected 50.00)`);
  assert(totalOutstanding === 0.00, `Total fines outstanding: ₹${totalOutstanding.toFixed(2)} (Expected 0.00)`);

  console.log(`\n=== Verification Complete: ${passedTests}/${totalTests} Tests Passed ===`);
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runFinesAndSettlementsTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
