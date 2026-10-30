package com.oxespace.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.oxespace.mobile.ui.HomeScreen
import com.oxespace.mobile.ui.theme.OxeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            OxeTheme {
                HomeScreen()
            }
        }
    }
}
