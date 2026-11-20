import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/home/presentation/home_screen.dart';
import '../../features/pantry/presentation/pantry_screen.dart';
import '../../features/meals/presentation/meal_planner_screen.dart';
import '../../features/chores/presentation/chores_screen.dart';
import '../../features/expenses/presentation/expenses_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      ShellRoute(
        builder: (context, state, child) {
          return MainNavigation(child: child);
        },
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const HomeScreen(),
          ),
          GoRoute(
            path: '/pantry',
            builder: (context, state) => const PantryScreen(),
          ),
          GoRoute(
            path: '/meals',
            builder: (context, state) => const MealPlannerScreen(),
          ),
          GoRoute(
            path: '/chores',
            builder: (context, state) => const ChoresScreen(),
          ),
          GoRoute(
            path: '/expenses',
            builder: (context, state) => const ExpensesScreen(),
          ),
        ],
      ),
    ],
  );
});

class MainNavigation extends StatelessWidget {
  final Widget child;

  const MainNavigation({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    int currentIndex = _calculateSelectedIndex(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (index) => _onItemTapped(index, context),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.kitchen_outlined),
            selectedIcon: Icon(Icons.kitchen),
            label: 'Pantry',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            selectedIcon: Icon(Icons.calendar_today),
            label: 'Meals',
          ),
          NavigationDestination(
            icon: Icon(Icons.check_box_outlined),
            selectedIcon: Icon(Icons.check_box),
            label: 'Chores',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Expenses',
          ),
        ],
      ),
    );
  }

  static int _calculateSelectedIndex(String location) {
    if (location.startsWith('/pantry')) return 1;
    if (location.startsWith('/meals')) return 2;
    if (location.startsWith('/chores')) return 3;
    if (location.startsWith('/expenses')) return 4;
    return 0; // Default to home
  }

  void _onItemTapped(int index, BuildContext context) {
    switch (index) {
      case 0:
        context.go('/');
        break;
      case 1:
        context.go('/pantry');
        break;
      case 2:
        context.go('/meals');
        break;
      case 3:
        context.go('/chores');
        break;
      case 4:
        context.go('/expenses');
        break;
    }
  }
}
