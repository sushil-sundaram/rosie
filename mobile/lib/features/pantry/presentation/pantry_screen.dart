import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';

final pantryItemsProvider = FutureProvider<List<dynamic>>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/pantry');
  return response.data as List<dynamic>;
});

class PantryScreen extends ConsumerWidget {
  const PantryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pantryItemsAsyncValue = ref.watch(pantryItemsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rosie', style: theme.textTheme.titleLarge?.copyWith(color: AppTheme.textPrimary)),
            Text('Smart Grocery & Pantry', style: theme.textTheme.labelSmall?.copyWith(color: AppTheme.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => ref.refresh(pantryItemsProvider),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: pantryItemsAsyncValue.when(
        data: (items) {
          if (items.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.inventory_2_outlined, size: 64, color: AppTheme.textMuted.withAlpha(120)),
                  const SizedBox(height: 16),
                  Text('Your pantry is empty', style: theme.textTheme.titleMedium?.copyWith(color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  Text('Add items to track stock and auto-replenish', style: theme.textTheme.bodySmall?.copyWith(color: AppTheme.textMuted)),
                ],
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            itemCount: items.length,
            separatorBuilder: (context, index) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final item = items[index];
              return Card(
                elevation: 0,
                color: AppTheme.surfaceContainerLow,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: const BorderSide(color: AppTheme.borderLight),
                ),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  leading: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppTheme.secondaryContainer.withAlpha(80),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.secondary.withAlpha(60)),
                    ),
                    child: const Icon(
                      Icons.local_florist_rounded,
                      color: AppTheme.secondary,
                      size: 22,
                    ),
                  ),
                  title: Text(
                    item['name'] ?? 'Unknown Item',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  subtitle: Text(
                    '${item['quantity'] ?? ''} ${item['unit'] ?? ''}'.trim(),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  trailing: Checkbox(
                    value: false,
                    onChanged: (val) {},
                  ),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off_rounded, size: 48, color: AppTheme.error),
              const SizedBox(height: 12),
              Text('Failed to load pantry', style: theme.textTheme.titleMedium?.copyWith(color: AppTheme.error)),
              const SizedBox(height: 6),
              Text('$error', style: theme.textTheme.bodySmall?.copyWith(color: AppTheme.textMuted)),
              const SizedBox(height: 16),
              FilledButton.tonal(
                onPressed: () => ref.refresh(pantryItemsProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        backgroundColor: AppTheme.primary,
        foregroundColor: AppTheme.onPrimary,
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}
