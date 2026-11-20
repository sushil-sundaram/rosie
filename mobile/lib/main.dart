import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/app_theme.dart';
import 'core/navigation/app_router.dart';

void main() {
  runApp(
    const ProviderScope(
      child: RosieApp(),
    ),
  );
}

class RosieApp extends ConsumerWidget {
  const RosieApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Rosie',
      theme: AppTheme.darkTheme,
      routerConfig: router,
    );
  }
}
