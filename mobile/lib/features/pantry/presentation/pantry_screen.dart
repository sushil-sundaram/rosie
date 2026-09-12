import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';

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

    return Scaffold(
      appBar: AppBar(
        title: const Text('MunchBox Pantry'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.refresh(pantryItemsProvider),
          ),
        ],
      ),
      body: pantryItemsAsyncValue.when(
        data: (items) {
          if (items.isEmpty) {
            return const Center(child: Text('Your pantry is empty.'));
          }
          return ListView.builder(
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              return ListTile(
                title: Text(item['name']),
                subtitle: Text('${item['quantity']} ${item['unit']}'),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Text('Failed to load pantry: $error'),
        ),
      ),
    );
  }
}
