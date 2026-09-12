import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'features/pantry/presentation/pantry_screen.dart';

void main() {
  runApp(
    const ProviderScope(
      child: MunchBoxApp(),
    ),
  );
}

class MunchBoxApp extends StatelessWidget {
  const MunchBoxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MunchBox',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.green),
        useMaterial3: true,
      ),
      home: const PantryScreen(),
    );
  }
}
