import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';

final expensesListProvider = FutureProvider<List<dynamic>>((ref) async {
  try {
    final dio = ref.watch(dioProvider);
    final response = await dio.get('/expenses');
    return response.data as List<dynamic>;
  } catch (_) {
    return [];
  }
});

class ExpensesScreen extends ConsumerStatefulWidget {
  const ExpensesScreen({super.key});

  @override
  ConsumerState<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends ConsumerState<ExpensesScreen> {
  final ImagePicker _picker = ImagePicker();

  Future<void> _showScanOptions(BuildContext context) async {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceContainerHigh,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.document_scanner_rounded, color: AppTheme.primary, size: 24),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Scan Receipt with Rosie AI', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                        const Text('Local AI will parse items, amount & category', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                ListTile(
                  leading: const Icon(Icons.camera_alt_rounded, color: AppTheme.primary),
                  title: const Text('Take Photo with Camera', style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text('Capture physical receipt using camera', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  tileColor: AppTheme.surfaceContainerLow,
                  onTap: () {
                    Navigator.pop(ctx);
                    _pickAndProcessReceipt(ImageSource.camera);
                  },
                ),
                const SizedBox(height: 10),
                ListTile(
                  leading: const Icon(Icons.photo_library_rounded, color: AppTheme.secondary),
                  title: const Text('Choose from Gallery', style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text('Select a saved receipt image', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  tileColor: AppTheme.surfaceContainerLow,
                  onTap: () {
                    Navigator.pop(ctx);
                    _pickAndProcessReceipt(ImageSource.gallery);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _pickAndProcessReceipt(ImageSource source) async {
    try {
      final XFile? photo = await _picker.pickImage(
        source: source,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 85,
      );

      if (photo == null || !mounted) return;

      // Show processing dialog
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => PopScope(
          canPop: false,
          child: AlertDialog(
            backgroundColor: AppTheme.surfaceContainerHigh,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            content: Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(color: AppTheme.primary),
                  const SizedBox(height: 20),
                  Text('Rosie AI is reading receipt...', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  const Text('Extracting vendor, totals & categories via local Ollama vision model', textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      );

      final bytes = await photo.readAsBytes();
      final base64Image = base64Encode(bytes);

      final dio = ref.read(dioProvider);
      final response = await dio.post(
        '/expenses/scan-receipt',
        data: {'image_base64': base64Image},
      );

      if (!mounted) return;
      Navigator.of(context, rootNavigator: true).pop(); // dismiss loading dialog

      final data = response.data;
      _showConfirmScannedDialog(
        initialTitle: data['title']?.toString() ?? 'Scanned Store',
        initialAmount: (data['amount'] as num?)?.toDouble() ?? 0.0,
        initialCategory: data['category']?.toString() ?? 'Groceries',
        initialDate: data['date']?.toString() ?? DateTime.now().toIso8601String().split('T').first,
      );
    } catch (e) {
      if (!mounted) return;
      Navigator.of(context, rootNavigator: true).pop(); // dismiss loading dialog if open

      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.surfaceContainerHigh,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.info_outline, color: AppTheme.primary),
              SizedBox(width: 8),
              Text('Local AI Receipt Scan'),
            ],
          ),
          content: Text(
            'Could not process receipt automatically via local AI: $e\n\n'
            'Ensure Ollama is running (`ollama serve`) and has a vision model installed (e.g. `ollama run llama3.2-vision` or `ollama run llava`).\n\n'
            'Would you like to log this expense manually?',
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(ctx);
                _showConfirmScannedDialog(
                  initialTitle: '',
                  initialAmount: 0.0,
                  initialCategory: 'Groceries',
                  initialDate: DateTime.now().toIso8601String().split('T').first,
                );
              },
              child: const Text('Enter Manually'),
            ),
          ],
        ),
      );
    }
  }

  void _showConfirmScannedDialog({
    required String initialTitle,
    required double initialAmount,
    required String initialCategory,
    required String initialDate,
  }) {
    final titleController = TextEditingController(text: initialTitle);
    final amountController = TextEditingController(text: initialAmount > 0 ? initialAmount.toStringAsFixed(2) : '');
    String selectedCategory = initialCategory;
    final dateController = TextEditingController(text: initialDate);

    final categories = ['Groceries', 'Utilities', 'Household', 'Dining', 'Entertainment', 'Transportation', 'Health', 'Other'];
    if (!categories.contains(selectedCategory)) {
      selectedCategory = 'Other';
    }

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: AppTheme.surfaceContainerHigh,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Row(
                children: [
                  Icon(Icons.auto_awesome, color: AppTheme.primary, size: 20),
                  SizedBox(width: 8),
                  Text('Confirm Scanned Expense'),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(
                        labelText: 'Merchant / Description',
                        prefixIcon: Icon(Icons.storefront_rounded),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: amountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'Amount (₹)',
                        prefixIcon: Icon(Icons.currency_rupee_rounded),
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: selectedCategory,
                      decoration: const InputDecoration(
                        labelText: 'Category',
                        prefixIcon: Icon(Icons.category_rounded),
                      ),
                      dropdownColor: AppTheme.surfaceContainerHighest,
                      items: categories.map((cat) => DropdownMenuItem(value: cat, child: Text(cat))).toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setDialogState(() => selectedCategory = val);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: dateController,
                      decoration: const InputDecoration(
                        labelText: 'Date (YYYY-MM-DD)',
                        prefixIcon: Icon(Icons.calendar_today_rounded),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () async {
                    final title = titleController.text.trim();
                    final amount = double.tryParse(amountController.text.trim()) ?? 0.0;
                    final date = dateController.text.trim();

                    if (title.isEmpty || amount <= 0) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please enter a valid title and amount')),
                      );
                      return;
                    }

                    Navigator.pop(ctx);
                    await _saveExpense(title, amount, selectedCategory, date);
                  },
                  child: const Text('Save Expense'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _saveExpense(String title, double amount, String category, String date) async {
    try {
      final dio = ref.read(dioProvider);
      await dio.post('/expenses', data: {
        'id': 0,
        'title': title,
        'amount': amount,
        'category': category,
        'date': date,
      });

      ref.invalidate(expensesListProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppTheme.surfaceContainerHigh,
          content: Text('✓ Added ₹${amount.toStringAsFixed(2)} for $title ($category)'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save expense: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final remoteExpenses = ref.watch(expensesListProvider);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rosie', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: AppTheme.textPrimary)),
            Text('Expenses & Receipt Scanner', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => ref.invalidate(expensesListProvider),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          _buildCycleSwitcher(),
          const SizedBox(height: 20),
          _buildHeroCard(context),
          const SizedBox(height: 20),
          _buildScanActionCard(context),
          const SizedBox(height: 20),
          _buildCategoryBreakdown(),
          const SizedBox(height: 20),
          _buildRecentOutlays(remoteExpenses),
          const SizedBox(height: 90),
        ],
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FloatingActionButton.extended(
            heroTag: 'scan_receipt_fab',
            onPressed: () => _showScanOptions(context),
            backgroundColor: AppTheme.primary,
            foregroundColor: AppTheme.onPrimary,
            icon: const Icon(Icons.document_scanner_rounded, size: 20),
            label: const Text('Scan Receipt'),
          ),
          const SizedBox(width: 12),
          FloatingActionButton.extended(
            heroTag: 'log_expense_fab',
            onPressed: () => _showConfirmScannedDialog(
              initialTitle: '',
              initialAmount: 0.0,
              initialCategory: 'Groceries',
              initialDate: DateTime.now().toIso8601String().split('T').first,
            ),
            backgroundColor: AppTheme.surfaceContainerHigh,
            foregroundColor: AppTheme.textPrimary,
            icon: const Icon(Icons.edit_note_rounded, size: 20),
            label: const Text('Manual Entry'),
          ),
        ],
      ),
    );
  }

  Widget _buildScanActionCard(BuildContext context) {
    return Card(
      elevation: 0,
      color: AppTheme.secondaryContainer.withValues(alpha: 0.25),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppTheme.secondary.withValues(alpha: 0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.secondaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.camera_alt_rounded, color: AppTheme.onSecondary, size: 24),
            ),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('AI Receipt Scanner', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  SizedBox(height: 2),
                  Text('Snap a receipt photo with your camera. Local AI extracts vendor, items, and adds expense.', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.tonal(
              onPressed: () => _showScanOptions(context),
              child: const Text('Scan'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCycleSwitcher() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: () {},
            style: IconButton.styleFrom(
              backgroundColor: AppTheme.surfaceContainerHigh,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
          Row(
            children: [
              const Icon(Icons.calendar_month, color: AppTheme.primary, size: 20),
              const SizedBox(width: 8),
              const Text('Current Outlay', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
                ),
                child: const Text('Active Cycle', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: () {},
            style: IconButton.styleFrom(
              backgroundColor: AppTheme.surfaceContainerHigh,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeroCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: const BoxDecoration(
                      color: AppTheme.primaryContainer,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('TOTAL HEARTH OUTLAY', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textMuted)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.borderLight),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.trending_up, color: AppTheme.primary, size: 14),
                    SizedBox(width: 4),
                    Text('Auto-Tracked', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('₹42,850', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              SizedBox(width: 8),
              Text('settled household cost', style: TextStyle(fontSize: 13, color: AppTheme.textMuted)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryBreakdown() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Category Segregation', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          _buildCategoryRow('Groceries & Pantry', '₹18,400', 0.43, AppTheme.primary),
          const SizedBox(height: 10),
          _buildCategoryRow('Utilities & Power', '₹12,250', 0.28, AppTheme.secondary),
          const SizedBox(height: 10),
          _buildCategoryRow('Household Essentials', '₹7,800', 0.18, const Color(0xFFFFBDBA)),
          const SizedBox(height: 10),
          _buildCategoryRow('Dining & Takeout', '₹4,400', 0.11, AppTheme.tertiary),
        ],
      ),
    );
  }

  Widget _buildCategoryRow(String title, String amount, double progress, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(title, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            Text(amount, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: progress,
            backgroundColor: AppTheme.surfaceContainerLow,
            valueColor: AlwaysStoppedAnimation<Color>(color),
            minHeight: 6,
          ),
        ),
      ],
    );
  }

  Widget _buildRecentOutlays(AsyncValue<List<dynamic>> remoteExpenses) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Row(
              children: [
                Icon(Icons.receipt_long, color: AppTheme.primary, size: 20),
                SizedBox(width: 8),
                Text('Recent Outlays Ledger', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            TextButton(
              onPressed: () {},
              child: const Text('Export CSV', style: TextStyle(fontSize: 12, color: AppTheme.primary)),
            )
          ],
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.borderLight),
          ),
          child: remoteExpenses.when(
            data: (items) {
              if (items.isEmpty) {
                return Column(
                  children: [
                    _buildLedgerItem("Trader Joe's", 'Oct 24 • Weekly Restock', 'Groceries', '₹2,850', 'Audited', Icons.storefront, AppTheme.primary),
                    const Divider(height: 1),
                    _buildLedgerItem("City Power & Gas", 'Oct 22 • Auto-debit', 'Utilities', '₹3,700', 'Direct Pay', Icons.power, AppTheme.secondary),
                    const Divider(height: 1),
                    _buildLedgerItem("Target Household", 'Oct 21 • Cleaners & Mops', 'Household', '₹960', 'Audited', Icons.cleaning_services, const Color(0xFFFFBDBA), bgIconColor: AppTheme.tertiary),
                  ],
                );
              }
              return ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: items.length,
                separatorBuilder: (context, index) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final item = items[index];
                  final title = item['title']?.toString() ?? 'Expense';
                  final amount = item['amount'] != null ? '₹${item['amount']}' : '₹0';
                  final category = item['category']?.toString() ?? 'Other';
                  final date = item['date']?.toString() ?? '';

                  return _buildLedgerItem(
                    title,
                    date,
                    category,
                    amount,
                    'Saved',
                    Icons.receipt_outlined,
                    AppTheme.primary,
                  );
                },
              );
            },
            loading: () => const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
            error: (_, __) => Column(
              children: [
                _buildLedgerItem("Trader Joe's", 'Oct 24 • Weekly Restock', 'Groceries', '₹2,850', 'Audited', Icons.storefront, AppTheme.primary),
                const Divider(height: 1),
                _buildLedgerItem("City Power & Gas", 'Oct 22 • Auto-debit', 'Utilities', '₹3,700', 'Direct Pay', Icons.power, AppTheme.secondary),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLedgerItem(String title, String subtitle, String category, String amount, String status, IconData icon, Color color, {Color? bgIconColor}) {
    final effectiveBgIconColor = bgIconColor ?? color;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: effectiveBgIconColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: effectiveBgIconColor.withValues(alpha: 0.25)),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: effectiveBgIconColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: effectiveBgIconColor.withValues(alpha: 0.2)),
                      ),
                      child: Text(category, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 8),
                    Text(subtitle, style: const TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                  ],
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(amount, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
              Text(status, style: const TextStyle(fontSize: 11, color: AppTheme.secondary)),
            ],
          ),
        ],
      ),
    );
  }
}
